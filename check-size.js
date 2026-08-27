/* 전송량 감시 — 깃허브 페이지스 월 100GB 소프트 한도를 넘기기 전에 미리 알린다.
   index.html 이 커질수록 방문자 한 명당 전송량이 늘고, 그만큼 감당 가능한
   방문자 수가 줄어든다. 이 스크립트는 그 한계를 매 배포마다 다시 계산한다. */
const fs = require('fs');
const zlib = require('zlib');

const 한도 = 100 * 1024 ** 3;          // 깃허브 페이지스 월 100GB
const 목표방문 = 400000;                // 우리가 버텨야 한다고 본 월 방문 수
const 경고선 = 0.80;                    // 한도의 80%를 넘으면 경고

function gz(p) {
  if (!fs.existsSync(p)) return 0;
  return zlib.gzipSync(fs.readFileSync(p), { level: 9 }).length;
}

const 본체 = gz('index.html');

// 기상 자료는 하루치만 받아 간다. 가장 큰 날짜 파일을 기준으로 잡는다.
let 기상 = 0;
try {
  for (const f of fs.readdirSync('data/wx')) {
    if (f === 'index.json') continue;
    기상 = Math.max(기상, gz('data/wx/' + f));
  }
} catch (e) {}

const 방문당 = 본체 + 기상;
const 한계방문 = Math.floor(한도 / 방문당);
const 목표사용량 = 목표방문 * 방문당;
const 비율 = 목표사용량 / 한도;

const kb = n => (n / 1024).toFixed(0) + 'KB';
const gb = n => (n / 1024 ** 3).toFixed(1) + 'GB';
const 쉼표 = n => n.toLocaleString('ko-KR');

const 줄 = [
  '# 전송량 점검',
  '',
  '| 항목 | 값 |',
  '|---|---|',
  `| 앱 본체 (압축 전송) | ${kb(본체)} |`,
  `| 기상 자료 하루치 | ${kb(기상)} |`,
  `| **방문자 한 명당** | **${kb(방문당)}** |`,
  `| 월 ${쉼표(목표방문)}명 방문 시 | ${gb(목표사용량)} / 100GB (${(비율 * 100).toFixed(0)}%) |`,
  `| **감당 가능한 월 방문 수** | **${쉼표(한계방문)}명** |`,
  '',
  '재방문자는 변경 없음(304) 응답이라 거의 전송이 없습니다. 위 수치는 전부 첫 방문 기준입니다.',
  '',
  비율 >= 1
    ? '**넘었습니다.** 지금 규모로 월 40만 방문이면 깃허브 한도를 초과합니다. 클라우드플레어 페이지스로 옮기세요(무료·무제한).'
    : 비율 >= 경고선
      ? `**주의.** 한도의 ${(비율 * 100).toFixed(0)}%까지 찼습니다. 세부 자리를 더 늘리기 전에 클라우드플레어 이전을 검토하세요.`
      : '여유 있습니다.',
  '',
  `점검 시각 ${new Date().toISOString()}`
].join('\n');

fs.writeFileSync('전송량점검.md', 줄 + '\n');
console.log(줄);

if (비율 >= 1) {
  console.error('::error::월 ' + 쉼표(목표방문) + '명 기준 전송량이 깃허브 한도를 넘습니다');
  process.exit(1);
}
if (비율 >= 경고선) {
  console.error('::warning::전송량이 한도의 ' + (비율 * 100).toFixed(0) + '%입니다');
}
