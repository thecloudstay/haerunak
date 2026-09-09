/**
 * 해루낚 — 국립해양조사원 실측값(조위·수온·파고)을 받아 저장소에 넣는다.
 *
 * 왜: 예보는 저기압·강풍이 오면 실제와 어긋난다. 「지금 물이 어디까지 왔는가」와
 *     「지금 물이 몇 도인가」는 실측이라야 뜻이 있다. 어종 제철 판단도 실측 수온이 맞다.
 *
 * 자료(공공데이터포털, 인증키 DATA_GO_KEY)
 *   최신 관측  apis.data.go.kr/1192136/dtRecent/GetDTRecentApiService
 *   실측 수온  apis.data.go.kr/1192136/surveyWaterTemp/GetSurveyWaterTempApiService
 *   실측 파랑  apis.data.go.kr/1192136/noonWave/GetNoonWaveApiService
 *
 * 출력: data/obs.json = { at:"2026-09-10 14:00", s:{ "DT_0001":{lv:cm, tw:수온, wv:파고m} } }
 *       파일 하나(수 KB)라 페이지가 통째로 받아 가장 가까운 관측소 값을 쓴다.
 */
const fs = require('fs');
const KEY = process.env.DATA_GO_KEY || '';
if (!KEY){ console.log('DATA_GO_KEY 없음 — 실측 수집 건너뜀'); process.exit(0); }

const stations = JSON.parse(fs.readFileSync('data/tide-stations.json','utf8')).stations;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const B = 'https://apis.data.go.kr/1192136/';

async function call(path, params){
  const q = Object.entries(params).map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&');
  const url = B + path + '?serviceKey=' + encodeURIComponent(KEY) + '&type=json&numOfRows=100&pageNo=1&' + q;
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch(e){ return null; }
    const body = (j.response && j.response.body) || j.body;
    if (!body || !body.items) return null;
    let it = body.items.item || body.items;
    if (!Array.isArray(it)) it = [it];
    return it;
  } catch(e){ return null; }
}
function num(v){ const n = +v; return isFinite(n) ? n : null; }

(async () => {
  const out = {};
  for (const st of stations){
    const rec = {};
    const r1 = await call('dtRecent/GetDTRecentApiService', { obsCode: st.code });
    if (r1 && r1[0]){
      const x = r1[0];
      rec.lv = num(x.tdlvVl ?? x.tideLevel ?? x.obsrvtTdlvVl);
      rec.tw = num(x.wtemVl ?? x.waterTemp ?? x.obsrvtWtemVl);
      rec.ws = num(x.wsVl ?? x.windSpeed);
      rec.at = x.obsrvtDt || x.recordTime || null;
    }
    await sleep(120);
    if (rec.tw == null){
      const r2 = await call('surveyWaterTemp/GetSurveyWaterTempApiService', { obsCode: st.code });
      if (r2 && r2.length){
        const x = r2[r2.length-1];
        rec.tw = num(x.wtemVl ?? x.waterTemp);
        rec.at = rec.at || x.obsrvtDt || null;
      }
      await sleep(120);
    }
    if (Object.keys(rec).length) out[st.code] = rec;
  }
  // 파고는 관측망이 따로다 — 지점 목록째로 받아 좌표와 함께 둔다
  let wave = [];
  const w = await call('noonWave/GetNoonWaveApiService', {});
  if (w) wave = w.map(x => ({
    n: x.obsvtrNm || x.obsPostName || '',
    la: num(x.lat), lo: num(x.lot ?? x.lon),
    h: num(x.wvhgtVl ?? x.waveHeight), p: num(x.wvprdVl ?? x.wavePeriod),
    at: x.obsrvtDt || null
  })).filter(x => x.la && x.lo && x.h != null);

  const at = new Date(Date.now() + 9*3600e3).toISOString().slice(0,16).replace('T',' ');
  fs.writeFileSync('data/obs.json', JSON.stringify({ at, s: out, wave }));
  console.log('관측소', Object.keys(out).length, '· 파고지점', wave.length);
})();
