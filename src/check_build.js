/* 해루낚 — 만들어진 index.html 이 실제로 돌아가는지 본다.
 *
 * 2026-09-14 사고: 주석을 고치다 닫는 자리를 잘못 두어 주석 밖으로 글이 새어 나갔다.
 * 그 한 줄 때문에 스크립트 전체가 죽어 사이트가 멈춘 채로 하루 가까이 배포되어 있었다.
 * 빌드가 통과해도 브라우저에서 안 돌 수 있으니, 여기서 한 번 더 걸러 낸다.
 */
const fs = require('fs');
const vm = require('vm');

const 파일 = process.argv[2] || '../index.html';
const s = fs.readFileSync(파일, 'utf8');

let 덩어리 = 0, 탈 = 0;
for (const m of s.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
  const 속성 = m[1] || '', 몸 = m[2];
  if (/\bsrc\s*=/.test(속성)) continue;            // 바깥 파일은 여기 없다
  if (/type\s*=\s*["'](?!text\/javascript|module)/.test(속성)) continue;  // json 등은 건너뛴다
  if (!몸.trim()) continue;
  덩어리++;
  try { new vm.Script(몸); }
  catch(e){
    탈++;
    const 줄 = s.slice(0, m.index).split('\n').length;
    console.error('::error::index.html 스크립트 구문 오류 (약 ' + 줄 + '째 줄부터) — ' + e.message);
    /* 어느 줄인지 짚어 준다 */
    const n = (e.message.match(/(\d+)/) || [])[1];
    if (n) console.error('   ' + 몸.split('\n').slice(Math.max(0,n-3), +n+2).join('\n   '));
  }
}

/* 꼭 있어야 하는 것들 — 빠지면 빌드가 반쯤 된 것이다 */
const 필수 = ['var POINTS', 'function nearStation_', 'var TIDE_FIX', 'L.map'];
const 빠짐 = 필수.filter(k => s.indexOf(k) < 0);
if (빠짐.length){ 탈++; console.error('::error::index.html 에 빠진 것 — ' + 빠짐.join(', ')); }

if (s.length < 300*1024){ 탈++; console.error('::error::index.html 이 너무 작다 — ' + Math.round(s.length/1024) + 'KB'); }

if (탈){ console.error('점검 실패 — 배포하면 안 된다'); process.exit(1); }
console.log('점검 통과 — 스크립트 ' + 덩어리 + '덩어리, ' + Math.round(s.length/1024) + 'KB');
