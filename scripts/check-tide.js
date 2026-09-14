/* 해루낚 — 물때 자료 점검
 *
 * 지점 하나가 이웃과 동떨어진 시각을 말하면 그 지점 자료를 의심해야 한다.
 * 실제로 「10년(마라도)_기점」이 마라도 이름으로 들어와 2시간 어긋난 적이 있다.
 * 그래서 매번 받아온 뒤 이웃끼리 맞춰 보고, 어긋나면 알려 둔다.
 */
const fs = require('fs');

const R = 6371;
const rad = d => d * Math.PI / 180;
function km(a, b, c, d){
  const v = Math.sin(rad(a)) * Math.sin(rad(c))
          + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.cos(rad(b - d));
  return R * Math.acos(Math.max(-1, Math.min(1, v)));
}

const 지점 = [];
const 본 = new Set();
for (const f of ['data/tide-stations.json', 'data/tide-points.json']){
  if (!fs.existsSync(f)) continue;
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const x of (j.stations || j.points || [])){
    if (x && x.code && !본.has(x.code) && isFinite(x.la) && isFinite(x.lo)){
      본.add(x.code); 지점.push(x);
    }
  }
}

const 날 = fs.readdirSync('data/tide').filter(f => f.endsWith('.json')).sort();
if (!날.length){ console.log('물때 파일이 없다'); process.exit(0); }
const 오늘 = JSON.parse(fs.readFileSync('data/tide/' + 날[Math.min(1, 날.length - 1)], 'utf8'));

const 쓸것 = 지점.filter(s => (오늘[s.code] || []).length);
const 저조 = c => (오늘[c] || []).filter(x => x.k === 'L').map(x => x.t);
const 조차 = c => {
  const v = (오늘[c] || []).map(x => x.lv);
  return v.length ? Math.max(...v) - Math.min(...v) : 0;
};

const 수상 = [];
for (const a of 쓸것){
  const 이웃 = 쓸것
    .filter(b => b.code !== a.code)
    .map(b => ({ d: km(a.la, a.lo, b.la, b.lo), b }))
    .filter(x => x.d <= 25)
    .sort((x, y) => x.d - y.d)
    .slice(0, 3);
  if (!이웃.length) continue;

  let 최소 = null;
  for (const { d, b } of 이웃){
    const 쌍 = [];
    for (const x of 저조(a.code)) for (const y of 저조(b.code))
      if (Math.abs(x - y) < 4) 쌍.push(Math.abs(x - y) * 60);
    if (!쌍.length) continue;
    const 평균 = 쌍.reduce((s, v) => s + v, 0) / 쌍.length;
    if (!최소 || 평균 < 최소.분) 최소 = { 분: 평균, 거리: d, 이름: b.name };
  }
  /* 조차가 작은 동해는 이웃끼리 위상이 한 시간쯤 벌어져도 멀쩡하다(읍천항이 그렇다).
     그래서 조차가 1m 안 되는 곳은 기준을 느슨하게 둔다. 마라도 사고는 113분이었다. */
  const 한계 = 조차(a.code) < 100 ? 100 : 45;
  if (최소 && 최소.분 >= 한계) 수상.push({ a, ...최소 });
}

수상.sort((x, y) => y.분 - x.분);
console.log('점검한 지점', 쓸것.length, '곳 · 의심', 수상.length, '곳');
for (const s of 수상){
  const 줄 = `${s.a.code} ${s.a.name} — 가장 가까운 이웃 ${s.이름}(${s.거리.toFixed(1)}km)와 간조가 ${Math.round(s.분)}분 어긋난다`;
  console.log('  ' + 줄);
  console.log('::warning::물때 지점 의심 — ' + 줄);
}
if (!수상.length) console.log('이웃끼리 어긋나는 지점 없음');
