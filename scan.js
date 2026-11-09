#!/usr/bin/env node
// scan.js
// CLI tool for batch processing CrystalDiskInfo screenshots into an Excel Disk Ledger

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  parseWithClaude,
  parseWithGemini,
  parseWithOpenAI,
  getSampleParsedData
} = require('./ai_parser');
const { parseCrystalDiskInfoText } = require('./text_parser');
const {
  saveLedgerToFile,
  importLedgerFromExcel,
  mergeDiskRecords
} = require('./excel_generator');

const SUPPORTED_EXTS = ['.png', '.jpg', '.jpeg', '.bmp', '.webp', '.txt', '.log'];

function printHelp() {
  console.log(`
사용법: node scan.js [이미지 폴더 또는 이미지 파일...] [옵션]

옵션:
  -o, --output <파일>      출력 엑셀 파일명 (기본값: 디스크관리대장.xlsx)
  -p, --provider <이름>    AI 제공자 (claude | gemini | openai, 기본값: claude)
  -k, --key <API키>        API 키 (또는 .env 파일의 환경변수 사용)
  -m, --model <모델명>     사용할 AI 모델명
  -s, --strategy <방식>    동일 시리얼 처리 방식: update(기존 갱신) | append(새 이력 추가) (기본값: update)
  --sample                 API 호출 없이 샘플 데이터로 엑셀 대장 생성 테스트
  -h, --help               도움말 출력

예시:
  node scan.js ./screenshots -o ./디스크관리대장.xlsx
  node scan.js ./sample_images/sample_crystaldiskinfo.jpg -p claude -k sk-ant-...
  node scan.js --sample
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    return;
  }

  let outputFile = '디스크관리대장.xlsx';
  let provider = 'claude';
  let apiKey = process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  let model = null;
  let strategy = 'update';
  let isSampleMode = false;
  const inputPaths = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-o' || arg === '--output') {
      outputFile = args[++i];
    } else if (arg === '-p' || arg === '--provider') {
      provider = args[++i].toLowerCase();
    } else if (arg === '-k' || arg === '--key') {
      apiKey = args[++i];
    } else if (arg === '-m' || arg === '--model') {
      model = args[++i];
    } else if (arg === '-s' || arg === '--strategy') {
      strategy = args[++i].toLowerCase();
    } else if (arg === '--sample') {
      isSampleMode = true;
    } else if (!arg.startsWith('-')) {
      inputPaths.push(arg);
    }
  }

  console.log('='.repeat(65));
  console.log('   CrystalDiskInfo -> 디스크 관리대장 CLI 자동 변환기');
  console.log('='.repeat(65));

  if (isSampleMode) {
    console.log('[모드] 샘플 데이터 모드로 실행합니다.');
    const sample = getSampleParsedData();
    sample.sourceFile = 'sample_crystaldiskinfo.jpg';
    const targetPath = path.resolve(process.cwd(), outputFile);
    await saveLedgerToFile([sample], targetPath);
    console.log(`[완료] 엑셀 관리대장이 저장되었습니다: ${targetPath}`);
    return;
  }

  if (inputPaths.length === 0) {
    console.error('오류: 분석할 이미지 파일이나 폴더를 지정해주세요.');
    printHelp();
    process.exit(1);
  }

  // Collect image files
  const imageFiles = [];
  for (const inputPath of inputPaths) {
    const resolved = path.resolve(process.cwd(), inputPath);
    if (!fs.existsSync(resolved)) {
      console.warn(`[경고] 대상이 존재하지 않습니다: ${inputPath}`);
      continue;
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(resolved);
      files.forEach(f => {
        const ext = path.extname(f).toLowerCase();
        if (SUPPORTED_EXTS.includes(ext)) {
          imageFiles.push(path.join(resolved, f));
        }
      });
    } else if (SUPPORTED_EXTS.includes(path.extname(resolved).toLowerCase())) {
      imageFiles.push(resolved);
    }
  }

  if (imageFiles.length === 0) {
    console.error('오류: 지정된 경로에서 유효한 파일(이미지 또는 TXT)을 찾을 수 없습니다.');
    process.exit(1);
  }

  const hasOnlyTextFiles = imageFiles.every(f => ['.txt', '.log'].includes(path.extname(f).toLowerCase()));
  if (!apiKey && !hasOnlyTextFiles) {
    console.error(`오류: 이미지 분석에는 ${provider.toUpperCase()} API 키가 필요합니다. -k 옵션이나 .env 파일로 지정하세요. (TXT 파일만 분석 시에는 키 불필요)`);
    process.exit(1);
  }

  console.log(`[시작] 총 ${imageFiles.length}개의 대상 파일 분석을 시작합니다.`);
  console.log(`[설정] AI 엔진: ${provider.toUpperCase()} | 병합 전략: ${strategy === 'update' ? '기존 시리얼 갱신' : '이력 추가'}`);

  // Load existing ledger if present
  const targetPath = path.resolve(process.cwd(), outputFile);
  let existingRecords = [];
  if (fs.existsSync(targetPath)) {
    try {
      console.log(`[알림] 기존 대장 파일 발견: ${outputFile} (기존 기록 불러오는 중...)`);
      existingRecords = await importLedgerFromExcel(targetPath);
      console.log(`[알림] 기존 ${existingRecords.length}개의 기록이 로드되었습니다.`);
    } catch (e) {
      console.warn(`[경고] 기존 엑셀 파일을 읽지 못해 새로 작성합니다: ${e.message}`);
    }
  }

  const newRecords = [];

  for (let idx = 0; idx < imageFiles.length; idx++) {
    const filePath = imageFiles[idx];
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    process.stdout.write(`[${idx + 1}/${imageFiles.length}] 분석 중: ${fileName}... `);

    try {
      if (ext === '.txt' || ext === '.log') {
        const content = fs.readFileSync(filePath, 'utf8');
        const parsedList = parseCrystalDiskInfoText(content);
        if (!parsedList || parsedList.length === 0) {
          throw new Error('유효한 CrystalDiskInfo 정보를 찾을 수 없습니다.');
        }

        parsedList.forEach((parsed, pIdx) => {
          parsed.id = `disk_${Date.now()}_${idx}_${pIdx}`;
          parsed.recordDate = new Date().toISOString().replace('T', ' ').substring(0, 16);
          parsed.sourceFile = fileName;
          newRecords.push(parsed);
        });

        console.log(`성공! (TXT 파일에서 ${parsedList.length}대 디스크 인식 완료)`);
        continue;
      }

      const buffer = fs.readFileSync(filePath);
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
      const base64 = buffer.toString('base64');

      let parsed = null;
      if (provider === 'claude') {
        parsed = await parseWithClaude({ imageBase64: base64, mimeType, apiKey, model });
      } else if (provider === 'gemini') {
        parsed = await parseWithGemini({ imageBase64: base64, mimeType, apiKey, model });
      } else if (provider === 'openai') {
        parsed = await parseWithOpenAI({ imageBase64: base64, mimeType, apiKey, model });
      }

      parsed.id = `disk_${Date.now()}_${idx}`;
      parsed.recordDate = new Date().toISOString().replace('T', ' ').substring(0, 16);
      parsed.sourceFile = fileName;

      const s05 = Number(parsed.smart?.['05_reallocated']?.dec || 0);
      const sC5 = Number(parsed.smart?.['C5_pending']?.dec || 0);
      const sC6 = Number(parsed.smart?.['C6_uncorrectable']?.dec || 0);
      const verdict = parsed.overallVerdict;

      let statusTag = `[${verdict}]`;
      if (verdict === '위험') statusTag = `\x1b[31m[위험 (05=${s05}, C5=${sC5}, C6=${sC6})]\x1b[0m`;
      else if (verdict === '주의') statusTag = `\x1b[33m[주의]\x1b[0m`;
      else statusTag = `\x1b[32m[정상]\x1b[0m`;

      console.log(`성공! -> ${parsed.model} (S/N: ${parsed.serialNumber || '미식별'}) ${statusTag}`);
      newRecords.push(parsed);
    } catch (err) {
      console.log(`실패: ${err.message}`);
    }
  }

  console.log('-'.repeat(65));
  console.log(`[통계] 성공: ${newRecords.length}개 / 실패: ${imageFiles.length - newRecords.length}개`);

  if (newRecords.length > 0) {
    const finalRecords = mergeDiskRecords(existingRecords, newRecords, strategy);
    await saveLedgerToFile(finalRecords, targetPath);
    console.log(`[완료] 디스크 관리대장이 저장되었습니다 -> ${targetPath}`);
    console.log(`[총계] 관리대장 내 총 디스크 수: ${finalRecords.length}개`);
  }
}

main().catch(err => {
  console.error('[오류 발생]:', err);
  process.exit(1);
});

