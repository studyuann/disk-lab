// text_parser.js
// Enhanced parser for CrystalDiskInfo text: supports single-disk and full multi-disk reports (Ctrl+C)

function parseSingleDiskBlock(blockText) {
  const lines = blockText.split(/\r?\n/);
  const result = {
    model: '',
    capacity: '',
    firmware: '',
    serialNumber: '',
    interface: '',
    transferMode: '',
    driveLetter: '',
    rotationRate: '',
    powerOnHours: 0,
    powerOnCount: 0,
    temperature: 0,
    healthStatus: '좋음',
    smart: {
      '01_readError': { hex: '000000000000', dec: 0 },
      '05_reallocated': { hex: '000000000000', dec: 0 },
      'C5_pending': { hex: '000000000000', dec: 0 },
      'C6_uncorrectable': { hex: '000000000000', dec: 0 },
      'C7_crc': { hex: '000000000000', dec: 0 }
    },
    overallVerdict: '정상',
    notes: ''
  };

  let inSmartSection = false;

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check header fields
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0 && !inSmartSection) {
      const key = trimmed.substring(0, colonIdx).trim().toLowerCase();
      const val = trimmed.substring(colonIdx + 1).trim();

      if (key === 'model' || key.includes('모델')) {
        result.model = val;
      } else if (key === 'serial number' || key.includes('일련번호') || key === 's/n') {
        result.serialNumber = val;
      } else if (key === 'disk size' || key.includes('용량') || key === 'capacity') {
        // e.g. "4000.7 GB (8.4/137.4/4000.7/4000.7)" -> "4000.7 GB"
        const cleanCap = val.split('(')[0].trim();
        result.capacity = cleanCap || val;
      } else if (key === 'firmware' || key.includes('펌웨어')) {
        result.firmware = val;
      } else if (key === 'interface' || key.includes('인터페이스')) {
        result.interface = val;
      } else if (key === 'transfer mode' || key.includes('전송 모드') || key.includes('전송모드')) {
        result.transferMode = val;
      } else if (key === 'rotation rate' || key.includes('회전 속도') || key.includes('회전수')) {
        result.rotationRate = val;
      } else if (key === 'drive letter' || key.includes('드라이브 문자') || key.includes('드라이브')) {
        result.driveLetter = val;
      } else if (key === 'power on hours' || key.includes('사용 시간') || key.includes('사용시간')) {
        const num = parseInt(val.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(num)) result.powerOnHours = num;
      } else if (key === 'power on count' || key.includes('사용 횟수') || key.includes('사용횟수')) {
        const num = parseInt(val.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(num)) result.powerOnCount = num;
      } else if (key === 'temperature' || key.includes('온도')) {
        // e.g. "30 C (86 F)" -> take 30
        const m = val.match(/(\d+)\s*[cC]/) || val.match(/^(\d+)/);
        if (m) result.temperature = parseInt(m[1], 10);
      } else if (key === 'health status' || key.includes('건강 상태') || key.includes('건강상태')) {
        result.healthStatus = val;
      }
    }

    // Check SMART section start
    if (trimmed.includes('-- S.M.A.R.T.') || trimmed.includes('ID Cur Wor Thr') || trimmed.includes('ID RawValues')) {
      inSmartSection = true;
      continue;
    }

    // Stop SMART section if IDENTIFY_DEVICE or another section starts
    if (inSmartSection && trimmed.startsWith('-- ')) {
      inSmartSection = false;
      continue;
    }

    // Parse SMART line
    if (inSmartSection) {
      // Examples:
      // "05 100 100 __5 000000000032 재할당된 섹터 수"
      // "05 000000000002 사용률" (NVMe)
      // "C7 200 200 __0 000000000001 울트라 DMA CRC 오류 횟수"
      const match = trimmed.match(/^([0-9A-Fa-f]{2})\s+(.+)/);
      if (match) {
        const id = match[1].toUpperCase();
        const rest = match[2];

        // Find 8~12 char hex string
        const hexMatch = rest.match(/([0-9A-Fa-f]{8,12})/);
        if (hexMatch) {
          const hexVal = hexMatch[1];
          const decVal = parseInt(hexVal, 16) || 0;

          if (id === '05' && !result.interface.includes('NVM')) {
            // SATA Reallocated sectors
            result.smart['05_reallocated'] = { hex: hexVal, dec: decVal };
          } else if (id === 'C5') {
            result.smart['C5_pending'] = { hex: hexVal, dec: decVal };
          } else if (id === 'C6') {
            result.smart['C6_uncorrectable'] = { hex: hexVal, dec: decVal };
          } else if (id === 'C7') {
            result.smart['C7_crc'] = { hex: hexVal, dec: decVal };
          } else if (id === '01') {
            result.smart['01_readError'] = { hex: hexVal, dec: decVal };
          }
        }
      }
    }
  }

  if (!result.model && !result.serialNumber) {
    return null;
  }

  // Calculate verdict
  const s05 = result.smart['05_reallocated']?.dec || 0;
  const sC5 = result.smart['C5_pending']?.dec || 0;
  const sC6 = result.smart['C6_uncorrectable']?.dec || 0;
  const sC7 = result.smart['C7_crc']?.dec || 0;
  const temp = result.temperature;
  const health = (result.healthStatus || '').toLowerCase();

  const isCritical = (
    s05 > 0 || sC5 > 0 || sC6 > 0 ||
    health.includes('위험') || health.includes('bad') || health.includes('fail')
  );

  const isWarning = (
    !isCritical && (
      health.includes('주의') || health.includes('caution') || health.includes('warn') ||
      sC7 > 0 || temp >= 50
    )
  );

  let verdict = '정상';
  if (isCritical) verdict = '위험';
  else if (isWarning) verdict = '주의';

  let issues = [];
  if (s05 > 0) issues.push(`재할당 섹터(${s05}개) 발생`);
  if (sC5 > 0) issues.push(`보류 중 섹터(${sC5}개) 발생`);
  if (sC6 > 0) issues.push(`회복 불가 섹터(${sC6}개) 발생`);
  if (sC7 > 0) issues.push(`CRC 오류(${sC7}회)`);
  if (temp >= 50) issues.push(`고온(${temp}°C)`);

  result.overallVerdict = verdict;
  result.notes = issues.length > 0 ? issues.join(', ') : '섹터 오류 없음, 상태 양호';

  return result;
}

/**
 * Parses full CrystalDiskInfo text (supports multiple disks in one report)
 * @param {string} text 
 * @returns {Array} Array of parsed disk objects
 */
function parseCrystalDiskInfoText(text) {
  if (!text || typeof text !== 'string') return [];

  // Split by disk section headers, e.g.:
  // ----------------------------------------------------------------------------
  //  (01) CT500P3PSSD8
  // ----------------------------------------------------------------------------
  const diskHeaderRegex = /-{40,}\r?\n\s*\(([0-9]{2})\)\s+[^\r\n]+\r?\n-{40,}/g;

  const matches = [...text.matchAll(diskHeaderRegex)];

  if (matches.length > 0) {
    const disks = [];
    for (let i = 0; i < matches.length; i++) {
      const startIndex = matches[i].index;
      const endIndex = (i + 1 < matches.length) ? matches[i + 1].index : text.length;
      const block = text.substring(startIndex, endIndex);

      const parsed = parseSingleDiskBlock(block);
      if (parsed) disks.push(parsed);
    }
    if (disks.length > 0) return disks;
  }

  // Single disk fallback
  const single = parseSingleDiskBlock(text);
  return single ? [single] : [];
}

module.exports = { parseCrystalDiskInfoText, parseSingleDiskBlock };
