// server.js
// Express Web Server for CrystalDiskInfo to Disk Ledger

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const {
  parseWithClaude,
  parseWithGemini,
  parseWithOpenAI,
  getSampleParsedData
} = require('./ai_parser');

const { parseCrystalDiskInfoText } = require('./text_parser');

const {
  generateExcelBuffer,
  saveLedgerToFile,
  importLedgerFromExcel,
  mergeDiskRecords
} = require('./excel_generator');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/sample_images', express.static(path.join(__dirname, 'sample_images')));

// Multer memory storage for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 } // 30MB limit per image
});

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', serverTime: new Date().toISOString() });
});

/**
 * Sample pre-parsed data
 */
app.get('/api/sample', (req, res) => {
  try {
    const sample = getSampleParsedData();
    sample.sourceFile = 'sample_crystaldiskinfo.jpg';
    sample.imageUrl = '/sample_images/sample_crystaldiskinfo.jpg';
    res.json({ success: true, data: [sample] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Parse CrystalDiskInfo text (from Ctrl+C or log file, supports multiple disks)
 */
app.post('/api/parse-text', (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: '분석할 텍스트가 없습니다.' });
    }

    const parsedList = parseCrystalDiskInfoText(text);
    if (!parsedList || parsedList.length === 0) {
      return res.status(400).json({ success: false, error: '유효한 CrystalDiskInfo 텍스트를 찾지 못했습니다.' });
    }

    const disks = parsedList.map((parsed, idx) => ({
      ...parsed,
      id: `disk_${Date.now()}_${idx}`,
      recordDate: new Date().toISOString().replace('T', ' ').substring(0, 16),
      sourceFile: '클립보드(Ctrl+V)'
    }));

    res.json({ success: true, data: disks, count: disks.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Scan & Analyze uploaded images
 */
app.post('/api/scan', upload.array('images', 50), async (req, res) => {
  try {
    const files = req.files || [];
    const provider = req.body.provider || 'claude';
    const apiKey = req.body.apiKey || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    const model = req.body.model;

    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: '분석할 이미지가 업로드되지 않았습니다.' });
    }

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: `${provider.toUpperCase()} API 키가 설정되지 않았습니다. 우측 상단 [API 설정]에서 키를 입력해주세요.`
      });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const base64Data = file.buffer.toString('base64');
      const mimeType = file.mimetype || 'image/jpeg';
      const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');

      try {
        let parsed = null;
        if (provider === 'claude') {
          parsed = await parseWithClaude({
            imageBase64: base64Data,
            mimeType,
            apiKey,
            model: model || 'claude-3-5-sonnet-20241022'
          });
        } else if (provider === 'gemini') {
          parsed = await parseWithGemini({
            imageBase64: base64Data,
            mimeType,
            apiKey,
            model: model || 'gemini-1.5-flash'
          });
        } else if (provider === 'openai') {
          parsed = await parseWithOpenAI({
            imageBase64: base64Data,
            mimeType,
            apiKey,
            model: model || 'gpt-4o'
          });
        } else {
          throw new Error(`지원하지 않는 AI 제공자입니다: ${provider}`);
        }

        parsed.id = `disk_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        parsed.recordDate = new Date().toISOString().replace('T', ' ').substring(0, 16);
        parsed.sourceFile = fileName;
        // Include thumbnail data uri for client preview
        parsed.thumbnailData = `data:${mimeType};base64,${base64Data}`;

        results.push(parsed);
      } catch (err) {
        console.error(`Error analyzing ${fileName}:`, err);
        errors.push({
          file: fileName,
          error: err.message
        });
      }
    }

    res.json({
      success: true,
      data: results,
      errors: errors.length > 0 ? errors : undefined,
      totalProcessed: files.length,
      successCount: results.length,
      failCount: errors.length
    });
  } catch (err) {
    console.error('Scan endpoint error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Export records to formatted Excel (.xlsx)
 */
app.post('/api/export-excel', async (req, res) => {
  try {
    const { records, filename } = req.body;
    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ success: false, error: '유효한 디스크 데이터가 없습니다.' });
    }

    const buffer = await generateExcelBuffer(records);
    const exportFileName = filename || `디스크관리대장_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(exportFileName)}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Save directly to workspace file (디스크관리대장.xlsx)
 */
app.post('/api/save-local-ledger', async (req, res) => {
  try {
    const { records, filename } = req.body;
    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ success: false, error: '유효한 디스크 데이터가 없습니다.' });
    }

    const targetFile = path.resolve(__dirname, filename || '디스크관리대장.xlsx');
    await saveLedgerToFile(records, targetFile);

    res.json({
      success: true,
      message: '디스크 관리대장이 성공적으로 저장되었습니다.',
      filePath: targetFile
    });
  } catch (err) {
    console.error('Save local ledger error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Import existing Excel ledger
 */
app.post('/api/import-excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '엑셀 파일이 업로드되지 않았습니다.' });
    }

    const records = await importLedgerFromExcel(req.file.buffer);
    res.json({
      success: true,
      data: records,
      count: records.length
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ success: false, error: '엑셀 파일을 읽는 중 오류가 발생했습니다: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  CrystalDiskInfo -> 디스크 관리대장 변환기 실행 완료!`);
  console.log(`  로컬 주소: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});

