/**
 * 해루낚 — 국립해양조사원(신 바다누리) 조류 예측을 미리 받아 저장소에 넣는다.
 *
 * 왜: 방문자 브라우저가 직접 조사원 API를 부르면 키가 노출되고 하루 한도(2만 회)에 걸린다.
 *     여기서 하루 한 번 받아 두면 방문자는 우리 파일만 읽는다. 예보는 하루 안에 안 바뀐다.
 *
 * 활성 조건: 저장소 시크릿 KHOA_KEY(신 바다누리 오픈API 인증키)가 있어야 돈다. 없으면 조용히 끝난다.
 *
 * 출력
 *   data/cur/<YYYY-MM-DD>/<HH>.json = { "t":"2026-09-08 14:00", "sp":10, "g":[[위도,경도,유속cm/s,유향deg],...] }
 *       ← 전국 격자(자동 간격, 대략 10km) 시각별 유향·유속. 오늘·내일 24시간씩.
 *   data/cur/pt/<YYYY-MM-DD>.json = { "<포인트번호>":[{"t":"02:30","k":"전류","v":12,"d":128},...], ... }
 *       ← 포인트마다 그날의 최강창조·최강낙조·전류(물 멈춤) 시각. 해루질 진입·퇴로 판단용.
 *
 * 호출 수: 격자 2일×24시간×상자 수(5) = 240회 + 포인트 613회 ≈ 850회/일 (한도 2만).
 */
const fs = require('fs');
const KEY = process.env.KHOA_KEY || '';
if (!KEY) { console.log('KHOA_KEY 없음 — 조류 갱신 건너뜀'); process.exit(0); }

const AREA = 'https://khoa.go.kr/oceandata/api/tidalCurrentArea/search.do';
const POINT = 'https://khoa.go.kr/oceandata/api/tidalCurrentPoint/search.do';

/* 전국을 다섯 상자로 — 상자 폭이 좁을수록 촘촘한 격자(1~10km 자동)를 준다.
   너무 촘촘하면 파일이 커지므로 2~3도 폭으로 잡아 5km 안팎을 노린다. */
const BOXES = [
  { n:'서해북부', MinX:124.5, MaxX:127.0, MinY:36.9, MaxY:38.2 },
  { n:'서해중부', MinX:125.3, MaxX:127.0, MinY:35.7, MaxY:36.9 },
  { n:'서남·제주', MinX:125.0, MaxX:127.3, MinY:33.0, MaxY:35.7 },
  { n:'남해',     MinX:127.3, MaxX:129.5, MinY:33.8, MaxY:35.4 },
  { n:'동해',     MinX:128.8, MaxX:130.2, MinY:35.4, MaxY:38.7 },
];

function kstDate(offsetDays) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}
function pad2(n) { return String(n).padStart(2, '0'); }
async function getJson(url) {
  const r = await fetch(url, { headers: { 'accept': 'application/json' } });
  const txt = await r.text();
  try { return JSON.parse(txt); } catch (e) { throw new Error('JSON 아님: ' + txt.slice(0, 120)); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchGridHour(ds, hh) {
  const date = ds.replace(/-/g, '');
  const g = [];
  for (const b of BOXES) {
    const url = AREA + '?ServiceKey=' + encodeURIComponent(KEY) + '&Date=' + date + '&Hour=' + pad2(hh) + '&Minute=00'
      + '&MaxX=' + b.MaxX + '&MinX=' + b.MinX + '&MaxY=' + b.MaxY + '&MinY=' + b.MinY + '&ResultType=json';
    try {
      const j = await getJson(url);
      const rows = (j && j.result && j.result.data) || [];
      for (const r of rows) {
        const la = +r.pre_lat, lo = +r.pre_lon, v = +r.current_speed, d = +r.current_dir;
        if (!isFinite(la) || !isFinite(lo) || !isFinite(v)) continue;
        g.push([+la.toFixed(4), +lo.toFixed(4), Math.round(v), Math.round(isFinite(d) ? d : 0)]);
      }
      if (j && j.result && j.result.meta && j.result.meta.obs_last_req_cnt) process.stdout.write('  잔여 ' + j.result.meta.obs_last_req_cnt + '\r');
    } catch (e) { console.log('  격자 실패', b.n, ds, hh, e.message); }
    await sleep(120);
  }
  return g;
}

async function fetchPoint(ds, p) {
  const date = ds.replace(/-/g, '');
  const url = POINT + '?ServiceKey=' + encodeURIComponent(KEY)
    + '&SDate=' + date + '&SHour=00&SMinute=00&EDate=' + date + '&EHour=23&EMinute=59'
    + '&lon=' + p.lo + '&lat=' + p.la + '&ResultType=json';
  const j = await getJson(url);
  const rows = (j && j.result && j.result.data) || [];
  return rows.map(r => {
    const t = String(r.obs_date || '').slice(11, 16);
    const k = String(r.type || '').replace('최강창조류', '최강창조').replace('최강낙조류', '최강낙조');
    return { t: t, k: k, v: Math.round(+r.current_speed || 0), d: Math.round(+r.current_dir || 0) };
  }).filter(x => x.t);
}

(async () => {
  const days = [kstDate(0), kstDate(1)];
  fs.mkdirSync('data/cur/pt', { recursive: true });

  /* 1) 시각별 격자 */
  for (const ds of days) {
    fs.mkdirSync('data/cur/' + ds, { recursive: true });
    for (let hh = 0; hh < 24; hh++) {
      const g = await fetchGridHour(ds, hh);
      if (!g.length) { console.log('격자 비어있음', ds, hh); continue; }
      fs.writeFileSync('data/cur/' + ds + '/' + pad2(hh) + '.json', JSON.stringify({ t: ds + ' ' + pad2(hh) + ':00', g: g }));
    }
    console.log('격자 완료', ds);
  }

  /* 2) 포인트별 최강창낙조·전류 (오늘·내일) */
  let points = [];
  try { points = JSON.parse(fs.readFileSync('data/points-min.json', 'utf8')); } catch (e) { console.log('data/points-min.json 없음 — 포인트 조류 건너뜀'); }
  for (const ds of days) {
    const out = {};
    let ok = 0, fail = 0;
    for (const p of points) {
      try { const ev = await fetchPoint(ds, p); if (ev.length) { out[p.i] = ev; ok++; } }
      catch (e) { fail++; if (fail < 5) console.log('  포인트 실패', p.i, e.message); }
      await sleep(60);
    }
    if (ok) fs.writeFileSync('data/cur/pt/' + ds + '.json', JSON.stringify(out));
    console.log('포인트 조류', ds, '성공', ok, '실패', fail);
  }

  /* 3) 이틀 넘은 자료는 지운다 — 저장소가 불어나지 않게 */
  const keep = new Set(days.concat([kstDate(-1)]));
  for (const f of fs.readdirSync('data/cur')) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(f) && !keep.has(f)) fs.rmSync('data/cur/' + f, { recursive: true, force: true });
  }
  for (const f of fs.readdirSync('data/cur/pt')) {
    const ds = f.replace('.json', '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(ds) && !keep.has(ds)) fs.rmSync('data/cur/pt/' + f, { force: true });
  }
})().catch(e => { console.error('조류 갱신 오류', e); process.exit(1); });
