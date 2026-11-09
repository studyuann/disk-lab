// excel_generator.js
// Generates and manages professional Excel (.xlsx) Disk Management Ledgers using exceljs

const ExcelJS = require('exceljs');
const fs = require('fs');

const COLUMNS = [
  { header: 'No.', key: 'no', width: 8, alignment: { horizontal: 'center' } },
  { header: '등록일시', key: 'recordDate', width: 18, alignment: { horizontal: 'center' } },
  { header: '종합 판정', key: 'overallVerdict', width: 12, alignment: { horizontal: 'center' } },
  { header: '건강 상태', key: 'healthStatus', width: 12, alignment: { horizontal: 'center' } },
  { header: '드라이브', key: 'driveLetter', width: 10, alignment: { horizontal: 'center' } },
  { header: '모델명', key: 'model', width: 28, alignment: { horizontal: 'left' } },
  { header: '일련번호 (S/N)', key: 'serialNumber', width: 22, alignment: { horizontal: 'center' } },
  { header: '용량', key: 'capacity', width: 14, alignment: { horizontal: 'right' } },
  { header: '현재 온도', key: 'temperatureDisplay', width: 12, alignment: { horizontal: 'center' } },
  { header: '사용 시간', key: 'powerOnHoursDisplay', width: 22, alignment: { horizontal: 'right' } },
  { header: '사용 횟수', key: 'powerOnCountDisplay', width: 14, alignment: { horizontal: 'right' } },
  { header: '[05] 재할당 섹터', key: 's05', width: 16, alignment: { horizontal: 'center' } },
  { header: '[C5] 보류 섹터', key: 'sC5', width: 15, alignment: { horizontal: 'center' } },
  { header: '[C6] 회복불가 섹터', key: 'sC6', width: 16, alignment: { horizontal: 'center' } },
  { header: '[C7] CRC 오류', key: 'sC7', width: 15, alignment: { horizontal: 'center' } },
  { header: '회전 속도', key: 'rotationRate', width: 14, alignment: { horizontal: 'center' } },
  { header: '인터페이스', key: 'interface', width: 20, alignment: { horizontal: 'left' } },
  { header: '전송 모드', key: 'transferMode', width: 22, alignment: { horizontal: 'left' } },
  { header: '펌웨어', key: 'firmware', width: 14, alignment: { horizontal: 'center' } },
  { header: '점검 소견 / 비고', key: 'notes', width: 36, alignment: { horizontal: 'left' } },
  { header: '원본 파일', key: 'sourceFile', width: 24, alignment: { horizontal: 'left' } }
];

function formatHours(hours) {
  if (hours == null || isNaN(hours)) return '-';
  const h = Number(hours);
  const days = (h / 24).toFixed(1);
  const years = (h / (24 * 365.25)).toFixed(1);
  if (h >= 8760) {
    return `${h.toLocaleString()} 시간 (약 ${years}년)`;
  } else if (h >= 24) {
    return `${h.toLocaleString()} 시간 (약 ${days}일)`;
  }
  return `${h.toLocaleString()} 시간`;
}

/**
 * Merge existing disk records with new disk records
 * @param {Array} existingRecords 
 * @param {Array} newRecords 
 * @param {'update'|'append'} mergeStrategy 
 */
function mergeDiskRecords(existingRecords = [], newRecords = [], mergeStrategy = 'update') {
  const merged = [...existingRecords];

  for (const item of newRecords) {
    if (!item.serialNumber) {
      merged.push({ ...item, id: item.id || `disk_${Date.now()}_${Math.random().toString(36).substr(2, 5)}` });
      continue;
    }

    const cleanSN = String(item.serialNumber).trim().toUpperCase();
    const existingIndex = merged.findIndex(r => r.serialNumber && String(r.serialNumber).trim().toUpperCase() === cleanSN);

    if (existingIndex !== -1 && mergeStrategy === 'update') {
      // Update existing record
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...item,
        updatedAt: new Date().toISOString()
      };
    } else {
      // Append as new row or new history record
      merged.push({
        ...item,
        id: item.id || `disk_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        recordDate: item.recordDate || new Date().toISOString().replace('T', ' ').substring(0, 16)
      });
    }
  }

  return merged;
}

/**
 * Build Excel Workbook from records
 */
async function createLedgerWorkbook(records = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CrystalDiskInfo to Ledger';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('디스크 관리대장', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  // Set columns
  worksheet.columns = COLUMNS.map(col => ({
    header: col.header,
    key: col.key,
    width: col.width
  }));

  // Style Header Row
  const headerRow = worksheet.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' } // Slate 800
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF475569' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: 'FF475569' } },
      right: { style: 'thin', color: { argb: 'FF475569' } }
    };
  });

  // Add Excel Notes (메모/주석) to critical headers
  const cell05 = headerRow.getCell('s05');
  cell05.note = {
    texts: [
      { text: '[05] 재할당된 섹터 수 (Reallocated Sectors)\n\n', font: { bold: true, size: 10, color: { argb: 'FFDC2626' } } },
      { text: '• 설명: 배드섹터가 발생하여 하드디스크의 예비 영역으로 대체된 섹터 수입니다.\n• 판정: 1개라도 발생하면 주의! 숫자가 계속 증가하면 디스크 수명 임박.\n• 조치: 즉시 중요 데이터 백업 및 디스크 교체 권장.' }
    ]
  };

  const cellC5 = headerRow.getCell('sC5');
  cellC5.note = {
    texts: [
      { text: '[C5] 보류 중인 섹터 수 (Current Pending Sector)\n\n', font: { bold: true, size: 10, color: { argb: 'FFDC2626' } } },
      { text: '• 설명: 물리적/논리적 오류로 읽기에 실패하여 재할당 대기 중인 불안정한 섹터 수입니다.\n• 판정: 치명적 위험 징후! 곧 영구 배드섹터(05)로 전환될 가능성이 매우 높음.\n• 조치: 사용 중지 및 즉시 데이터 백업 필수.' }
    ]
  };

  const cellC6 = headerRow.getCell('sC6');
  cellC6.note = {
    texts: [
      { text: '[C6] 회복 불가능 섹터 수 (Offline Uncorrectable)\n\n', font: { bold: true, size: 10, color: { argb: 'FFDC2626' } } },
      { text: '• 설명: 자체 검사 중 복구 및 예비 섹터 대체조차 실패한 완전 불량 섹터 수입니다.\n• 판정: 최고 위험! 데이터 손실이 이미 발생하고 있음을 의미함.\n• 조치: 즉시 디스크 교체 및 폐기 대상.' }
    ]
  };

  const cellC7 = headerRow.getCell('sC7');
  cellC7.note = {
    texts: [
      { text: '[C7] 울트라 DMA CRC 오류 횟수 (UltraDMA CRC Error)\n\n', font: { bold: true, size: 10, color: { argb: 'FFD97706' } } },
      { text: '• 설명: 디스크와 메인보드 사이의 SATA/USB 데이터 전송 통신 오류 횟수입니다.\n• 판정: 디스크 자체 플래터 불량보다는 케이블 불량/접촉 불량일 가능성이 90% 이상입니다.\n• 조치: SATA 케이블 교체, 먼지 청소, 다른 포트에 재연결 후 수치 증가 여부 확인.' }
    ]
  };

  // Fill Data Rows
  records.forEach((record, index) => {
    const s05 = Number(record.smart?.['05_reallocated']?.dec ?? record.s05 ?? 0);
    const sC5 = Number(record.smart?.['C5_pending']?.dec ?? record.sC5 ?? 0);
    const sC6 = Number(record.smart?.['C6_uncorrectable']?.dec ?? record.sC6 ?? 0);
    const sC7 = Number(record.smart?.['C7_crc']?.dec ?? record.sC7 ?? 0);
    const temp = Number(record.temperature ?? 0);
    const hours = Number(record.powerOnHours ?? 0);
    const count = Number(record.powerOnCount ?? 0);
    const verdict = record.overallVerdict || '정상';

    const isCritical = verdict === '위험' || s05 > 0 || sC5 > 0 || sC6 > 0;
    const isWarning = !isCritical && (verdict === '주의' || sC7 > 0 || temp >= 50);

    const rowData = {
      no: index + 1,
      recordDate: record.recordDate || new Date().toISOString().replace('T', ' ').substring(0, 16),
      overallVerdict: verdict,
      healthStatus: record.healthStatus || '좋음',
      driveLetter: record.driveLetter || '-',
      model: record.model || '-',
      serialNumber: record.serialNumber || '-',
      capacity: record.capacity || '-',
      temperatureDisplay: temp ? `${temp} °C` : '-',
      powerOnHoursDisplay: formatHours(hours),
      powerOnCountDisplay: count ? `${count.toLocaleString()} 회` : '-',
      s05: s05,
      sC5: sC5,
      sC6: sC6,
      sC7: sC7,
      rotationRate: record.rotationRate || '-',
      interface: record.interface || '-',
      transferMode: record.transferMode || '-',
      firmware: record.firmware || '-',
      notes: record.notes || '-',
      sourceFile: record.sourceFile || record.fileName || '-'
    };

    const row = worksheet.addRow(rowData);
    row.height = 24;

    // Row-level base fill color based on condition
    let rowBgColor = 'FFFFFFFF';
    if (isCritical) {
      rowBgColor = 'FFFEE2E2'; // Light red
    } else if (isWarning) {
      rowBgColor = 'FFFEF3C7'; // Light amber/yellow
    } else if (index % 2 === 1) {
      rowBgColor = 'FFF8FAFC'; // Light striped slate
    }

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: '맑은 고딕', size: 9 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: rowBgColor }
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: COLUMNS[colNumber - 1]?.alignment?.horizontal || 'left',
        wrapText: colNumber === 20 // Notes column
      };
    });

    // Specific highlight on critical cells
    const cellVerdict = row.getCell('overallVerdict');
    if (verdict === '위험') {
      cellVerdict.font = { name: '맑은 고딕', size: 9, bold: true, color: { argb: 'FF991B1B' } };
      cellVerdict.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFECACA' } };
    } else if (verdict === '주의') {
      cellVerdict.font = { name: '맑은 고딕', size: 9, bold: true, color: { argb: 'FF92400E' } };
      cellVerdict.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } };
    } else {
      cellVerdict.font = { name: '맑은 고딕', size: 9, bold: true, color: { argb: 'FF166534' } };
      cellVerdict.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
    }

    // Highlight 05, C5, C6 if > 0
    ['s05', 'sC5', 'sC6'].forEach(key => {
      const cell = row.getCell(key);
      const val = Number(cell.value);
      if (val > 0) {
        cell.font = { name: '맑은 고딕', size: 9, bold: true, color: { argb: 'FF7F1D1D' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF87171' } };
      }
    });

    // Highlight C7 if > 0
    const cellC7 = row.getCell('sC7');
    if (Number(cellC7.value) > 0) {
      cellC7.font = { name: '맑은 고딕', size: 9, bold: true, color: { argb: 'FF92400E' } };
      cellC7.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCD34D' } };
    }

    // Highlight temperature if >= 50
    if (temp >= 50) {
      const cellTemp = row.getCell('temperatureDisplay');
      cellTemp.font = { name: '맑은 고딕', size: 9, bold: true, color: { argb: 'FF9A3412' } };
      cellTemp.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDBA74' } };
    }
  });

  // Add Second Sheet: S.M.A.R.T Reference Guide
  const guideSheet = workbook.addWorksheet('SMART 점검가이드');
  guideSheet.columns = [
    { header: '항목 코드', key: 'code', width: 14 },
    { header: '항목명 (한글/영문)', key: 'name', width: 32 },
    { header: '정상 기준', key: 'safe', width: 15 },
    { header: '위험/주의 기준', key: 'warning', width: 18 },
    { header: '증상 및 상세 설명', key: 'desc', width: 45 },
    { header: '권장 조치 사항', key: 'action', width: 40 }
  ];

  // Header styling for guide
  const gHeader = guideSheet.getRow(1);
  gHeader.height = 28;
  gHeader.eachCell(cell => {
    cell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const guideRows = [
    {
      code: '[05]',
      name: '재할당된 섹터 수\n(Reallocated Sectors Count)',
      safe: '0',
      warning: '1 이상 (위험)',
      desc: '디스크에 물리적인 배드섹터가 발생하여 하드디스크 내부의 예비(Spare) 섹터로 교체된 횟수입니다.',
      action: '1개라도 발생하면 중요 데이터를 즉시 외장하드/클라우드로 백업하세요. 숫자가 점점 늘어난다면 디스크 교체가 시급합니다.'
    },
    {
      code: '[C5]',
      name: '보류 중인 섹터 수\n(Current Pending Sector Count)',
      safe: '0',
      warning: '1 이상 (위험)',
      desc: '물리적/논리적 손상으로 정상적으로 읽지 못해 예비 섹터로 재할당 대기 중인 불안정한 섹터입니다.',
      action: '매우 위험한 전조 증상입니다. 언제든지 영구 배드섹터로 굳어질 수 있으므로 즉시 데이터 백업 후 디스크 교체를 준비하세요.'
    },
    {
      code: '[C6]',
      name: '회복 불가능 섹터 수\n(Offline Uncorrectable Sector Count)',
      safe: '0',
      warning: '1 이상 (매우 위험)',
      desc: '디스크 자체 검사 중 복구 및 예비 섹터 재할당조차 실패한 완전히 죽은 섹터입니다.',
      action: '이미 데이터 유실이 발생하고 있을 확률이 99%입니다. 시스템 디스크로 사용을 중지하고 즉시 폐기/교체하세요.'
    },
    {
      code: '[C7]',
      name: '울트라 DMA CRC 오류\n(UltraDMA CRC Error Count)',
      safe: '0',
      warning: '1 이상 (주의)',
      desc: '디스크와 메인보드 간에 데이터를 주고받는 과정에서 발생한 전송 통신 오류 횟수입니다.',
      action: '하드디스크 본체 불량보다는 SATA/USB 케이블 접촉 불량이나 노후화일 가능성이 큽니다. 케이블을 교체하거나 다른 단자에 연결하세요.'
    },
    {
      code: '[01]',
      name: '읽기 오류율\n(Raw Read Error Rate)',
      safe: '원시값 0',
      warning: '원시값 증가 추세',
      desc: '디스크 표면에서 데이터를 읽는 과정에서 하드웨어 오류가 발생한 빈도입니다.',
      action: '원시값이 지속적으로 증가하면 헤드(Head) 또는 플래터 표면 손상 가능성이 있으므로 점검이 필요합니다.'
    },
    {
      code: '온도',
      name: '현재 작동 온도\n(Temperature)',
      safe: '20°C ~ 45°C',
      warning: '50°C 이상 (주의/위험)',
      desc: '저장장치 내부 컨트롤러 및 플래터의 현재 작동 온도입니다.',
      action: '50°C가 넘어가면 디스크 수명이 급격히 단축됩니다. 본체 쿨링팬 점검, 통풍구 청소, 방열판 장착을 권장합니다.'
    }
  ];

  guideRows.forEach((r, idx) => {
    const row = guideSheet.addRow(r);
    row.height = 36;
    row.eachCell((cell, colNum) => {
      cell.font = { name: '맑은 고딕', size: 9 };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNum <= 4 ? 'center' : 'left',
        wrapText: true
      };
      if (r.warning.includes('위험')) {
        if (colNum === 4) {
          cell.font = { name: '맑은 고딕', size: 9, bold: true, color: { argb: 'FF991B1B' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        }
      } else if (r.warning.includes('주의')) {
        if (colNum === 4) {
          cell.font = { name: '맑은 고딕', size: 9, bold: true, color: { argb: 'FF92400E' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        }
      }
    });
  });

  return workbook;
}

/**
 * Generate Excel buffer
 */
async function generateExcelBuffer(records) {
  const workbook = await createLedgerWorkbook(records);
  return await workbook.xlsx.writeBuffer();
}

/**
 * Save to local file
 */
async function saveLedgerToFile(records, filePath) {
  const workbook = await createLedgerWorkbook(records);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

/**
 * Import records from an existing Excel file
 */
async function importLedgerFromExcel(filePathOrBuffer) {
  const workbook = new ExcelJS.Workbook();
  if (typeof filePathOrBuffer === 'string') {
    await workbook.xlsx.readFile(filePathOrBuffer);
  } else {
    await workbook.xlsx.load(filePathOrBuffer);
  }

  const worksheet = workbook.getWorksheet(1);
  if (!worksheet) return [];

  const records = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    const record = {
      recordDate: row.getCell(2).text,
      overallVerdict: row.getCell(3).text,
      healthStatus: row.getCell(4).text,
      driveLetter: row.getCell(5).text,
      model: row.getCell(6).text,
      serialNumber: row.getCell(7).text,
      capacity: row.getCell(8).text,
      temperatureDisplay: row.getCell(9).text,
      powerOnHoursDisplay: row.getCell(10).text,
      powerOnCountDisplay: row.getCell(11).text,
      s05: parseInt(row.getCell(12).text, 10) || 0,
      sC5: parseInt(row.getCell(13).text, 10) || 0,
      sC6: parseInt(row.getCell(14).text, 10) || 0,
      sC7: parseInt(row.getCell(15).text, 10) || 0,
      rotationRate: row.getCell(16).text,
      interface: row.getCell(17).text,
      transferMode: row.getCell(18).text,
      firmware: row.getCell(19).text,
      notes: row.getCell(20).text,
      sourceFile: row.getCell(21).text
    };

    if (record.model || record.serialNumber) {
      records.push(record);
    }
  });

  return records;
}

module.exports = {
  COLUMNS,
  formatHours,
  mergeDiskRecords,
  createLedgerWorkbook,
  generateExcelBuffer,
  saveLedgerToFile,
  importLedgerFromExcel
};

