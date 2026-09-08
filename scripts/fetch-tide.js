/**
 * 해루낚 — 국립해양조사원 공식 물때(조석예보)를 미리 받아 저장소에 넣는다.
 *
 * 왜: 라이브 사이트는 지금 자체 조석계산(calcTide_)을 쓴다. 이 스크립트가 돌면
 *     공식 예보로 갈아끼워 정확도가 오른다. 바다타임을 긁지 않으므로 저작권 문제 없음.
 *
 * 활성 조건: 저장소 시크릿 KHOA_KEY 가 있어야 돈다. 없으면 조용히 끝난다(현 상태).
 *     국립해양조사원 신 바다누리(khoa.go.kr/oceandata)에서 조석예보 API 신청 → 키를
 *     GitHub 저장소 Settings > Secrets > Actions 에 KHOA_KEY 로 넣으면 자동 작동.
 *
 * 출력: data/tide/<YYYY-MM-DD>.json = { "DT_0001":[{k,t,lv}...], ... } (15일치)
 */
const fs = require('fs');
const KEY = process.env.KHOA_KEY || '';
const BASE = process.env.KHOA_TIDE_URL ||
  'http://www.khoa.go.kr/api/oceangrid/tideObsPreTab/search.do';   // 신 서비스 확정 시 시크릿/변수로 교체

if (!KEY){ console.log('KHOA_KEY 없음 — 물때 수집 건너뜀(자체계산 유지)'); process.exit(0); }

const stations = JSON.parse(fs.readFileSync('data/tide-stations.json','utf8')).stations;
const today = new Date(Date.now() + 9*3600e3);
function ds(d){ return d.toISOString().slice(0,10); }

async function one(code, dstr){
  const url = BASE + '?ServiceKey=' + encodeURIComponent(KEY)
    + '&ObsCode=' + code + '&Date=' + dstr.replace(/-/g,'') + '&ResultType=json';
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const list = (j.result && j.result.data) || j.data || [];
    if (!list.length) return null;
    const ev = list.map(x => {
      const hm = String(x.tph_time || x.record_time || '').split(' ')[1] || '00:00';
      const a = hm.split(':');
      const hl = x.hl_code || x.hl || '';
      return { k: (hl.indexOf('고') >= 0 || hl === 'H') ? 'H' : 'L',
               t: (+a[0]) + (+a[1])/60, lv: Math.round(+(x.tph_level || x.record_level || 0)) };
    }).filter(e => !isNaN(e.t)).sort((a,b) => a.t - b.t);
    return ev.length ? ev : null;
  } catch(e){ return null; }
}

(async () => {
  fs.mkdirSync('data/tide', { recursive: true });
  for (let k = -1; k <= 14; k++){
    const d = new Date(today.getTime() + k*86400e3);
    const dstr = ds(d);
    const out = {};
    for (const s of stations){
      const ev = await one(s.code, dstr);
      if (ev) out[s.code] = ev;
      await new Promise(r => setTimeout(r, 120));   // API 예의
    }
    if (Object.keys(out).length)
      fs.writeFileSync('data/tide/' + dstr + '.json', JSON.stringify(out));
  }
  console.log('물때 수집 완료');
})();
