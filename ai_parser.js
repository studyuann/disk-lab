// ai_parser.js
// Handles AI Vision recognition (Claude API, Gemini API, OpenAI API) for CrystalDiskInfo screenshots

const SYSTEM_PROMPT = `당신은 저장장치(HDD/SSD) 진단 도구인 'CrystalDiskInfo' 스크린샷 전문 데이터 추출기입니다.
제공된 CrystalDiskInfo 캡처 이미지(한국어, 영어, 일본어, 시즈쿠/쿠레이 에디션 등 모든 테마 지원)를 정밀하게 분석하여 JSON으로만 응답하세요.

추출해야 하는 항목:
1. model: 상단에 표시된 디스크 모델명 (예: "HGST HUS724040ALA640")
2. capacity: 모델명 옆 또는 상단의 용량 (예: "4000.7 GB" 또는 "4.0 TB")
3. firmware: 펌웨어 (예: "MFA0AA70")
4. serialNumber: 일련번호 / Serial Number (예: "PN1334PAKRYN5X")
5. interface: 인터페이스 (예: "UASP (Serial ATA)", "NVM Express", "SATA")
6. transferMode: 전송 모드 (예: "SATA/600 | SATA/600", "PCIe 4.0 x4 | PCIe 4.0 x4")
7. driveLetter: 드라이브 문자 (예: "E:", "C: D:", 없으면 "-")
8. standard: 표준 규격 (예: "ATA8-ACS | ATA8-ACS version 4", "NVM Express 1.4")
9. rotationRate: 회전 속도 (예: "7200 RPM", "5400 RPM", SSD인 경우 "---- (SSD)")
10. powerOnCount: 사용 횟수 (정수, 예: "55 회" -> 55)
11. powerOnHours: 사용 시간 (정수, 예: "47036 시간" -> 47036)
12. temperature: 현재 온도 (숫자 섭씨, 예: "35 °C" -> 35)
13. healthStatus: 건강 상태 표시 텍스트 (예: "좋음", "주의", "위험", "Good", "Caution", "Bad")
14. healthPercentage: 건강 상태가 백분율로 표기된 경우 숫자(없으면 100 또는 null)

15. S.M.A.R.T. 핵심 항목 추출 (하단 테이블에서 ID 및 특성 이름 기준):
- 01_readErrorRate (01 읽기 오류율): raw 16진수 문자열 및 10진수 환산값
- 05_reallocatedSectors (05 재할당된 섹터 수 / Reallocated Sectors Count): 원시 값 (Hex 및 10진수)
- C5_currentPendingSectors (C5 보류 중인 섹터 수 / Current Pending Sector Count): 원시 값 (Hex 및 10진수)
- C6_uncorrectableSectors (C6 회복 불가능 섹터 수 / Offline Uncorrectable Sector Count): 원시 값 (Hex 및 10진수)
- C7_ultraDmaCrcErrors (C7 울트라 DMA CRC 오류 횟수 / UltraDMA CRC Error Count): 원시 값 (Hex 및 10진수)

16. 종합 판정 (overallVerdict):
- "위험": 05(재할당), C5(보류), C6(회복불가) 섹터 중 1개라도 0보다 큰 경우, 또는 건강 상태가 '위험'/'Bad'인 경우
- "주의": 건강 상태가 '주의'/'Caution'이거나, C7(CRC오류) > 0 (케이블 점검 필요)이거나, 온도가 50도 이상인 경우
- "정상": 위의 위험/주의 조건에 해당하지 않고 건강상태가 좋은 경우

17. notes: 상태 요약 및 주의사항 메모 (예: "재할당 섹터 0개로 양호하나 과거 CRC 오류 1회 발생(케이블 접촉 불량 이력 추정)")

출력은 반드시 다른 설명 없이 유효한 JSON 형식이어야 합니다.
JSON 스키마 예시:
{
  "model": "HGST HUS724040ALA640",
  "capacity": "4000.7 GB",
  "firmware": "MFA0AA70",
  "serialNumber": "PN1334PAKRYN5X",
  "interface": "UASP (Serial ATA)",
  "transferMode": "SATA/600 | SATA/600",
  "driveLetter": "E:",
  "standard": "ATA8-ACS | ATA8-ACS version 4",
  "rotationRate": "7200 RPM",
  "powerOnCount": 55,
  "powerOnHours": 47036,
  "temperature": 35,
  "healthStatus": "좋음",
  "healthPercentage": 100,
  "smart": {
    "05_reallocated": { "hex": "000000000000", "dec": 0 },
    "C5_pending": { "hex": "000000000000", "dec": 0 },
    "C6_uncorrectable": { "hex": "000000000000", "dec": 0 },
    "C7_crc": { "hex": "000000000001", "dec": 1 },
    "01_readError": { "hex": "000000000000", "dec": 0 }
  },
  "overallVerdict": "정상",
  "notes": "섹터 이상 없음. CRC 오류 1건(케이블 점검 권장)."
}`;

function cleanJsonResponse(rawText) {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

function calculateVerdictAndNotes(data) {
  const s05 = Number(data.smart?.['05_reallocated']?.dec ?? 0);
  const sC5 = Number(data.smart?.['C5_pending']?.dec ?? 0);
  const sC6 = Number(data.smart?.['C6_uncorrectable']?.dec ?? 0);
  const sC7 = Number(data.smart?.['C7_crc']?.dec ?? 0);
  const temp = Number(data.temperature ?? 0);
  const health = (data.healthStatus || '').toLowerCase();

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
  if (sC7 > 0) issues.push(`CRC 오류(${sC7}회) - 케이블 점검`);
  if (temp >= 50) issues.push(`고온 주의(${temp}°C)`);

  let note = issues.length > 0 ? issues.join(', ') : '섹터 오류 없음, 상태 양호';

  return {
    ...data,
    overallVerdict: data.overallVerdict || verdict,
    notes: data.notes || note
  };
}

/**
 * Call Anthropic Claude Vision API
 */
async function parseWithClaude({ imageBase64, mimeType = 'image/jpeg', apiKey, model = 'claude-3-5-sonnet-20241022' }) {
  if (!apiKey) throw new Error('Claude API 키가 제공되지 않았습니다.');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: imageBase64
              }
            },
            {
              type: 'text',
              text: '이 CrystalDiskInfo 스크린샷에서 모든 디스크 사양과 SMART 지표를 JSON으로 추출해주세요.'
            }
          ]
        }
      ]
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Claude API 호출 실패 (${res.status}): ${errorText}`);
  }

  const json = await res.json();
  const textContent = json.content?.find(c => c.type === 'text')?.text || '';
  const parsed = cleanJsonResponse(textContent);
  return calculateVerdictAndNotes(parsed);
}

/**
 * Call Google Gemini Vision API
 */
async function parseWithGemini({ imageBase64, mimeType = 'image/jpeg', apiKey, model = 'gemini-1.5-flash' }) {
  if (!apiKey) throw new Error('Gemini API 키가 제공되지 않았습니다.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: SYSTEM_PROMPT + '\n\n위 규칙에 따라 다음 이미지에서 데이터를 추출하여 JSON으로 반환하세요.' },
            {
              inlineData: {
                mimeType: mimeType,
                data: imageBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gemini API 호출 실패 (${res.status}): ${errorText}`);
  }

  const json = await res.json();
  const candidateText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = cleanJsonResponse(candidateText);
  return calculateVerdictAndNotes(parsed);
}

/**
 * Call OpenAI Vision API
 */
async function parseWithOpenAI({ imageBase64, mimeType = 'image/jpeg', apiKey, model = 'gpt-4o' }) {
  if (!apiKey) throw new Error('OpenAI API 키가 제공되지 않았습니다.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: '이 이미지에서 CrystalDiskInfo 정보를 추출하세요.' },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`
              }
            }
          ]
        }
      ],
      response_format: { type: 'json_object' }
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenAI API 호출 실패 (${res.status}): ${errorText}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || '';
  const parsed = cleanJsonResponse(content);
  return calculateVerdictAndNotes(parsed);
}

/**
 * Sample pre-parsed data (for the provided sample screenshot)
 */
function getSampleParsedData() {
  return calculateVerdictAndNotes({
    model: 'HGST HUS724040ALA640',
    capacity: '4000.7 GB',
    firmware: 'MFA0AA70',
    serialNumber: 'PN1334PAKRYN5X',
    interface: 'UASP (Serial ATA)',
    transferMode: 'SATA/600 | SATA/600',
    driveLetter: 'E:',
    standard: 'ATA8-ACS | ATA8-ACS version 4',
    rotationRate: '7200 RPM',
    powerOnCount: 55,
    powerOnHours: 47036,
    temperature: 35,
    healthStatus: '좋음',
    healthPercentage: 100,
    smart: {
      '01_readError': { hex: '000000000000', dec: 0 },
      '05_reallocated': { hex: '000000000000', dec: 0 },
      'C5_pending': { hex: '000000000000', dec: 0 },
      'C6_uncorrectable': { hex: '000000000000', dec: 0 },
      'C7_crc': { hex: '000000000001', dec: 1 }
    },
    overallVerdict: '정상',
    notes: '섹터 문제 없음 (05=0, C5=0, C6=0). C7 CRC 오류 1회 감지(과거 케이블 접촉 불량 이력 추정).'
  });
}

module.exports = {
  SYSTEM_PROMPT,
  parseWithClaude,
  parseWithGemini,
  parseWithOpenAI,
  getSampleParsedData,
  calculateVerdictAndNotes
};

