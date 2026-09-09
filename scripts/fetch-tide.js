/**
 * 해루낚 — 국립해양조사원 공식 조석예보를 미리 받아 저장소에 넣는다.
 *
 * 왜: 지금은 자체 조석계산(달 위상 근사)으로 물때를 낸다. 공식 예보로 갈아끼우면
 *     만조·간조 시각이 분 단위로 맞는다. 물때가 이 앱의 심장이라 정확도가 곧 신뢰다.
 *
 * 자료: 공공데이터포털 「국립해양조사원_조석예보(고, 저조)」
 *   GET https://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService
 *       ?serviceKey=&obsCode=DT_0001&reqDate=20260910&type=json&numOfRows=300
 *   응답 body.items.item[] = { obsvtrNm, lat, lot, predcDt, predcTdlvVl(cm),
 *                              extrSe: 1 오전고조 2 오전저조 3 오후고조 4 오후저조 }
 *
 * 활성 조건: 저장소 시크릿 DATA_GO_KEY(공공데이터포털 일반 인증키, 디코딩값).
 *            없으면 조용히 끝난다(자체계산 유지).
 *
 * 출력: data/tide/<YYYY-MM-DD>.json = { "DT_0001":[{k:'H'|'L', t:시각(소수), lv:조위cm}], ... }
 */
const fs = require('fs');
const KEY = process.env.DATA_GO_KEY || process.env.KHOA_KEY || '';
const BASE = 'https://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService';
const DAYS = 15;

if (!KEY){ console.log('DATA_GO_KEY 없음 — 물때 수집 건너뜀(자체계산 유지)'); process.exit(0); }

const stations = JSON.parse(fs.readFileSync('data/tide-stations.json','utf8')).stations;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function kst(off){ return new Date(Date.now() + 9*3600e3 + off*86400e3).toISOString().slice(0,10); }

async function one(code, ds){
  const url = BASE + '?serviceKey=' + encodeURIComponent(KEY)
    + '&obsCode=' + code + '&reqDate=' + ds.replace(/-/g,'')
    + '&type=json&numOfRows=300&pageNo=1';
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch(e){ return null; }
    const body = (j.response && j.response.body) || j.body;
    if (!body) return null;
    let items = body.items && (body.items.item || body.items);
    if (!items) return null;
    if (!Array.isArray(items)) items = [items];
    const ev = items.map(x => {
      // predcDt: "2026-09-10 05:12:00" 또는 "20260910051200"
      const s = String(x.predcDt || '');
      let hh, mm;
      const m = s.match(/(\d{2}):(\d{2})/);
      if (m){ hh = +m[1]; mm = +m[2]; }
      else { const d = s.replace(/\D/g,''); hh = +d.slice(8,10); mm = +d.slice(10,12); }
      if (isNaN(hh) || isNaN(mm)) return null;
      const se = +x.extrSe;                       // 1,3 = 고조 / 2,4 = 저조
      return { k: (se === 1 || se === 3) ? 'H' : 'L', t: hh + mm/60, lv: Math.round(+x.predcTdlvVl || 0) };
    }).filter(Boolean).sort((a,b) => a.t - b.t);
    return ev.length ? ev : null;
  } catch(e){ return null; }
}

(async () => {
  fs.mkdirSync('data/tide', { recursive: true });
  let ok = 0, miss = 0;
  for (let d = 0; d < DAYS; d++){
    const ds = kst(d);
    const out = {};
    for (const st of stations){
      const ev = await one(st.code, ds);
      if (ev){ out[st.code] = ev; ok++; } else miss++;
      await sleep(120);                    // 초당 10건 이하로 — 기관 부담을 줄인다
    }
    if (Object.keys(out).length){
      fs.writeFileSync('data/tide/' + ds + '.json', JSON.stringify(out));
      console.log(ds, Object.keys(out).length + '개 관측소');
    }
  }
  // 오래된 파일 정리 — 어제보다 이전 것은 쓸모가 없다
  const keep = new Set(Array.from({length: DAYS+1}, (_,i) => kst(i-1) + '.json'));
  for (const f of fs.readdirSync('data/tide')) if (!keep.has(f)) fs.unlinkSync('data/tide/' + f);
  console.log('받음', ok, '· 없음', miss);
})();
