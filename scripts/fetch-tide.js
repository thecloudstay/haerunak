/**
 * 해루낚 — 국립해양조사원 공식 조석예보를 미리 받아 저장소에 넣는다.
 *
 * 왜: 물때가 이 앱의 심장이라 정확도가 곧 신뢰다. 관측소 27곳만 쓰면 강화 외포처럼
 *     수로(교동대교)와 외해(외포) 사이에서 30분씩 어긋난다. 그래서 예보지점(마을 단위)까지 받는다.
 *
 * 자료: 공공데이터포털 「국립해양조사원_조석예보(고, 저조)」
 *   GET https://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService
 *       ?serviceKey=&obsCode=DT_0001|SO_0563&reqDate=20260910&type=json&numOfRows=300
 *   응답 body.items.item[] = { obsvtrNm, lat, lot, predcDt, predcTdlvVl(cm), extrSe: 1 오전고조 2 오전저조 3 오후고조 4 오후저조 }
 *
 * 대상: data/tide-stations.json(관측소) + data/tide-points.json(예보지점, scan-tide-points.js 가 채움) 가운데
 *       해루낚 포인트(data/points-min.json)에서 25km 안에 있는 곳.
 *
 * 절약: 예보는 안 바뀐다. 이미 받은 날짜·지점은 다시 부르지 않고, 없는 것만 가까운 날짜부터 채운다.
 *       한 번에 BUDGET 개까지만 부른다(하루 호출 한도). 며칠 돌면 15일치가 다 찬다.
 *
 * 출력: data/tide/<YYYY-MM-DD>.json = { "DT_0001":[{k:'H'|'L', t:시각(소수), lv:조위cm}], "SO_0563":[...] }
 */
const fs = require('fs');
const KEY = process.env.DATA_GO_KEY || process.env.KHOA_KEY || '';
const BASE = 'https://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService';
const DAYS = 15, NEAR_KM = 25;
let BUDGET = +(process.env.FETCH_BUDGET || 900);
try { BUDGET -= +(fs.readFileSync('/tmp/tide_calls_used','utf8') || 0); } catch(e){}
if (!KEY){ console.log('DATA_GO_KEY 없음 — 물때 수집 건너뜀(자체계산 유지)'); process.exit(0); }

const rj = f => { try { return JSON.parse(fs.readFileSync(f,'utf8')); } catch(e){ return null; } };
const stations = (rj('data/tide-stations.json') || {}).stations || [];
const points   = (rj('data/tide-points.json') || {}).points || [];
const spots    = rj('data/points-min.json') || [];

function km(a,b,c,d){ const r=Math.PI/180,x=(c-a)*r,y=(d-b)*r;
  const h=Math.sin(x/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)**2; return 2*6371*Math.asin(Math.sqrt(h)); }
function nearSpot(p){ return spots.some(s => km(p.la,p.lo,s.la,s.lo) <= NEAR_KM); }

/* 관측소는 전부, 예보지점은 우리 포인트 근처만 */
const targets = [];
const seen = new Set();
for (const s of stations){ if (!seen.has(s.code)){ seen.add(s.code); targets.push(s); } }
for (const p of points){ if (!seen.has(p.code) && nearSpot(p)){ seen.add(p.code); targets.push(p); } }

const sleep = ms => new Promise(r => setTimeout(r, ms));
function kst(off){ return new Date(Date.now() + 9*3600e3 + off*86400e3).toISOString().slice(0,10); }
async function one(code, ds){
  const url = BASE + '?serviceKey=' + encodeURIComponent(KEY)
    + '&obsCode=' + code + '&reqDate=' + ds.replace(/-/g,'') + '&type=json&numOfRows=300&pageNo=1';
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const j = JSON.parse(await r.text());
    const hd = (j.response && j.response.header) || j.header || {};
    if (String(hd.resultCode) === '22' || /LIMITED_NUMBER/.test(String(hd.resultMsg))) throw new Error('LIMIT');
    const body = (j.response && j.response.body) || j.body;
    if (!body) return null;
    let items = body.items && (body.items.item || body.items);
    if (!items) return null;
    if (!Array.isArray(items)) items = [items];
    const ev = items.map(x => {
      const s = String(x.predcDt || '');
      let hh, mm;
      const m = s.match(/(\d{2}):(\d{2})/);
      if (m){ hh = +m[1]; mm = +m[2]; }
      else { const d = s.replace(/\D/g,''); hh = +d.slice(8,10); mm = +d.slice(10,12); }
      if (isNaN(hh) || isNaN(mm)) return null;
      const se = +x.extrSe;
      return { k: (se === 1 || se === 3) ? 'H' : 'L', t: hh + mm/60, lv: Math.round(+x.predcTdlvVl || 0) };
    }).filter(Boolean).sort((a,b) => a.t - b.t);
    return ev.length ? ev : null;
  } catch(e){ if (e && e.message === 'LIMIT') throw e; return null; }
}

(async () => {
  fs.mkdirSync('data/tide', { recursive: true });
  console.log('대상 지점', targets.length, '(관측소', stations.length, '· 예보지점', targets.length - stations.length, ') · 예산', BUDGET);
  let used = 0, ok = 0, miss = 0, changed = 0;
  for (let d = 0; d < DAYS && used < BUDGET; d++){
    const ds = kst(d), f = 'data/tide/' + ds + '.json';
    const out = rj(f) || {};
    let touched = false;
    for (const st of targets){
      if (out[st.code] && out[st.code].length) continue;      // 이미 있다
      if (used >= BUDGET) break;
      used++;
      let ev = null;
      try { ev = await one(st.code, ds); }
      catch(e){ console.log('하루 호출 한도에 닿음 — 여기서 멈추고 내일 이어 받는다'); BUDGET = 0; }
      if (ev){ out[st.code] = ev; ok++; touched = true; } else miss++;
      await sleep(110);
    }
    if (touched){ fs.writeFileSync(f, JSON.stringify(out)); changed++; }
    console.log(ds, Object.keys(out).length + '/' + targets.length);
  }
  const keep = new Set(Array.from({length: DAYS+1}, (_,i) => kst(i-1) + '.json'));
  for (const x of fs.readdirSync('data/tide')) if (!keep.has(x)) fs.unlinkSync('data/tide/' + x);
  console.log('호출', used, '· 받음', ok, '· 없음', miss, '· 바뀐 날짜 파일', changed);
})();
