/**
 * 해루낚 — 기상 자료 미리 받기
 *
 * 지점 좌표를 0.4도 격자로 묶어 Open-Meteo 에 한 번에 물어보고,
 * 오늘부터 이레치를 data/wx.json 에 저장한다.
 * 방문자 브라우저는 이 파일만 읽으므로 외부 호출이 필요 없다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DAYS = 7;                       // 오늘 포함 이레
const CHUNK = 30;                     // 한 번에 물어볼 격자 수

/* 지점 좌표는 앱 본체(index.html)에 박혀 있다 — 거기서 뽑아 쓴다 */
function readPoints(){
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const out = [];
  const re = /la:\s*(-?\d+(?:\.\d+)?)\s*,\s*lo:\s*(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(src))) out.push({ la: +m[1], lo: +m[2] });
  return out;
}

function gridKey(la, lo){
  return (Math.round(la/0.4)*0.4).toFixed(1) + ',' + (Math.round(lo/0.4)*0.4).toFixed(1);
}

function kstToday(){
  const d = new Date(Date.now() + 9*3600*1000);
  return d.toISOString().slice(0,10);
}
function addDays(ds, n){
  const d = new Date(ds + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0,10);
}

async function getJson(url, tries){
  tries = tries || 3;
  for (let i = 0; i < tries; i++){
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      if (r.status === 429){ await new Promise(s=>setTimeout(s, 8000*(i+1))); continue; }
    } catch(e){
      await new Promise(s=>setTimeout(s, 3000*(i+1)));
    }
  }
  return null;
}

(async () => {
  const points = readPoints();
  if (!points.length){ console.error('지점 좌표를 못 찾았습니다'); process.exit(1); }

  const cells = {};
  points.forEach(p => { const k = gridKey(p.la, p.lo); if (!cells[k]) cells[k] = { la:+k.split(',')[0], lo:+k.split(',')[1] }; });
  const keys = Object.keys(cells);

  const from = kstToday(), to = addDays(from, DAYS-1);
  console.log(`지점 ${points.length}곳 · 격자 ${keys.length}칸 · ${from} ~ ${to}`);

  const wx = {};
  let calls = 0;

  for (let s = 0; s < keys.length; s += CHUNK){
    const chunk = keys.slice(s, s + CHUNK);
    const lats = chunk.map(k => cells[k].la).join(',');
    const lons = chunk.map(k => cells[k].lo).join(',');

    const land = await getJson('https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + lats + '&longitude=' + lons
      + '&hourly=temperature_2m,apparent_temperature,precipitation,precipitation_probability,'
      + 'weather_code,visibility,snowfall,cloud_cover,wind_speed_10m,wind_gusts_10m,'
      + 'wind_direction_10m,surface_pressure'
      + '&timezone=Asia%2FSeoul&start_date=' + from + '&end_date=' + to
      + '&wind_speed_unit=ms');
    calls++;

    const sea = await getJson('https://marine-api.open-meteo.com/v1/marine'
      + '?latitude=' + lats + '&longitude=' + lons
      + '&hourly=wave_height,wave_period,sea_surface_temperature'
      + '&timezone=Asia%2FSeoul&start_date=' + from + '&end_date=' + to);
    calls++;

    if (!land){ console.error('육상 기상 실패 — 이 묶음 건너뜀'); continue; }

    const La = Array.isArray(land) ? land : [land];
    const Sa = sea ? (Array.isArray(sea) ? sea : [sea]) : [];

    chunk.forEach((k, i) => {
      const L = La[i], S = Sa[i];
      if (!L || !L.hourly) return;
      const H = L.hourly, M = S && S.hourly ? S.hourly : {};
      /* 시각 배열을 날짜별로 24칸씩 자른다 */
      for (let d = 0; d < DAYS; d++){
        const ds = addDays(from, d), a = d*24, b = a+24;
        /* 자리수를 줄여 파일을 가볍게 만든다 — 계산 정확도에는 영향이 없다 */
        const r1 = v => (v === null || v === undefined) ? null : Math.round(v*10)/10;
        const r2 = v => (v === null || v === undefined) ? null : Math.round(v*100)/100;
        const cut  = arr => (arr ? arr.slice(a, b).map(r1) : null);
        const cutF = arr => (arr ? arr.slice(a, b).map(r2) : null);
        const cutI = arr => (arr ? arr.slice(a, b).map(v => v===null||v===undefined?null:Math.round(v)) : null);
        wx[ds + '|' + k] = {
          temp: cut(H.temperature_2m),        feel: cut(H.apparent_temperature),
          rain: cutF(H.precipitation),        cloud: cutI(H.cloud_cover),
          rainP: cutI(H.precipitation_probability), code: cutI(H.weather_code),
          vism: cutI(H.visibility),           snow: cutF(H.snowfall),
          wind: cut(H.wind_speed_10m),        gust: cut(H.wind_gusts_10m),
          wdir: cutI(H.wind_direction_10m),   pres: cut(H.surface_pressure),
          wave: cutF(M.wave_height),          wper: cut(M.wave_period),
          sst:  cut(M.sea_surface_temperature)
        };
      }
    });

    await new Promise(s2 => setTimeout(s2, 1200));   // 예의상 간격
  }

  /* 날짜별로 따로 저장한다 — 방문자는 오늘치 한 파일만 받으면 된다 */
  const dir = path.join(ROOT, 'data', 'wx');
  fs.mkdirSync(dir, { recursive: true });
  const 받은시각 = new Date().toISOString();
  let total = 0;
  const days = [];
  for (let d = 0; d < DAYS; d++){
    const ds = addDays(from, d);
    const one = {};
    keys.forEach(k => { const v = wx[ds + '|' + k]; if (v) one[k] = v; });
    if (!Object.keys(one).length) continue;
    const f = path.join(dir, ds + '.json');
    fs.writeFileSync(f, JSON.stringify({ 받은시각: 받은시각, 날짜: ds, 자료: one }));
    total += fs.statSync(f).size;
    days.push(ds);
  }
  /* 어느 날짜가 준비돼 있는지 알려주는 목차 */
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({
    _설명: '미리 받아 둔 기상 자료 목차. 방문자 브라우저는 여기 있는 날짜면 외부 호출 없이 바로 쓴다.',
    _주의: '손으로 고치지 말 것. 세 시간마다 자동으로 덮어쓴다.',
    받은시각: 받은시각, 격자수: keys.length, 날짜: days
  }));
  /* 낡은 날짜 파일은 지운다 */
  fs.readdirSync(dir).forEach(f => {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (m && days.indexOf(m[1]) < 0) fs.unlinkSync(path.join(dir, f));
  });
  console.log(`완료 — 호출 ${calls}회 · 격자 ${keys.length}칸 · 날짜 ${days.length}개 · 합계 ${Math.round(total/1024)}KB (하루당 ${Math.round(total/1024/days.length)}KB)`);
})();
