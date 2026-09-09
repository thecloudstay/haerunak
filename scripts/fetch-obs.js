/**
 * 해루낚 — 국립해양조사원 조위관측소 최신 관측값을 받아 저장소에 넣는다.
 *
 * 왜: 예보는 저기압·강풍이 오면 실제와 어긋난다. 「지금 물이 어디까지 왔고 몇 도인가」는
 *     실측이라야 뜻이 있다. 어종 제철 판단도 실측 수온이 맞다.
 *
 * 자료: 공공데이터포털 「국립해양조사원_조위관측소 최신 관측데이터」
 *   GET https://apis.data.go.kr/1192136/dtRecent/GetDTRecentApiService
 *       ?serviceKey=&obsCode=DT_0001&type=json&numOfRows=1
 *   응답 item[0] = { obsvtrNm 관측소명, obsrvnDt 관측일시, bscTdlvHgt 조위(cm),
 *                    wtem 수온, wspd 풍속, wndrct 풍향, artmp 기온, atmpr 기압, slntQty 염분 }
 *
 * 출력: data/obs.json = { at, s:{ "DT_0001":{lv,tw,ws,wd,at} } }  — 파일 하나(수 KB)
 */
const fs = require('fs');
const KEY = process.env.DATA_GO_KEY || '';
if (!KEY){ console.log('DATA_GO_KEY 없음 — 실측 수집 건너뜀'); process.exit(0); }

const stations = JSON.parse(fs.readFileSync('data/tide-stations.json','utf8')).stations;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = 'https://apis.data.go.kr/1192136/dtRecent/GetDTRecentApiService';
const num = v => { const n = +v; return isFinite(n) ? n : null; };

async function one(code){
  const url = URL + '?serviceKey=' + encodeURIComponent(KEY)
    + '&obsCode=' + code + '&type=json&numOfRows=1&pageNo=1';
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch(e){ return null; }
    const body = (j.response && j.response.body) || j.body;
    if (!body || !body.items) return null;
    let it = body.items.item || body.items;
    if (!Array.isArray(it)) it = [it];
    const x = it[0];
    if (!x) return null;
    const rec = {
      lv: num(x.bscTdlvHgt),      // 조위 cm
      tw: num(x.wtem),            // 수온 ℃
      ws: num(x.wspd),            // 풍속 m/s
      wd: num(x.wndrct),          // 풍향 deg
      at: x.obsrvnDt || null
    };
    return (rec.lv != null || rec.tw != null) ? rec : null;
  } catch(e){ return null; }
}

(async () => {
  const out = {};
  let ok = 0;
  for (const st of stations){
    const rec = await one(st.code);
    if (rec){ out[st.code] = rec; ok++; }
    await sleep(120);              // 초당 8건 이하로 — 기관 부담을 줄인다
  }
  const at = new Date(Date.now() + 9*3600e3).toISOString().slice(0,16).replace('T',' ');
  fs.writeFileSync('data/obs.json', JSON.stringify({ at, s: out }));
  console.log('관측소', ok, '/', stations.length);
})();
