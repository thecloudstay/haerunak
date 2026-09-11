/* 도감·지점 페이지에 쓸 정적 정보만 뽑는다.
   물때·날씨처럼 매일 바뀌는 값은 넣지 않는다 — 검색 색인이 흔들리지 않게. */
const fs = require('fs');
const g = global;

function loadVar(file, names){
  let src = fs.readFileSync(file, 'utf8');
  names.forEach(n => { src = src.replace(new RegExp('^var ' + n + '\\b', 'm'), 'g.' + n); });
  // 함수 선언도 살린다
  src = src.replace(/^function (\w+)/gm, 'g.$1 = function $1');
  try { eval(src); } catch(e){ console.error(file, '일부 미해석:', e.message); }
}

loadVar('Points.gs', ['POINTS','FX_BY','SP_DEFAULT','FX_DEFAULT','SEASON_SP','SEASON_FX','FLOOR_KO']);
loadVar('Rig.gs',    ['RIGS','SAFE_KIT','GEAR_NORM']);
loadVar('Ban.gs',    ['BANS','BAN_META','NONPRO']);
loadVar('Spots.gs',  ['SPOTS']);

/* 저장소의 data/*.json 확장분을 정적 페이지에도 그대로 반영한다 */
function rj(n){ try { return JSON.parse(fs.readFileSync('ghup/data/'+n+'.json','utf8')); } catch(e){ return null; } }
(function mergeExtra(){
  const px = rj('points-extra');
  if (px && px.points && px.points.length){
    const map = {};
    (g.POINTS||[]).forEach(p => { map[p.i] = p; });
    px.points.forEach(p => { if (p && p.i) map[p.i] = map[p.i] ? Object.assign({}, map[p.i], p) : p; });
    g.POINTS = Object.keys(map).map(k => map[k])
      .filter(p => p.la && p.lo && p.mr !== undefined && p.n);
  }
  const rx = rj('rigs');
  if (rx) Object.keys(rx).forEach(k => { if (k[0] !== '_') g.RIGS[k] = rx[k]; });
  const bx = rj('ban-extra');
  if (bx){
    const rm = bx.remove || [];
    g.BANS = (g.BANS||[]).filter(r => rm.indexOf(r.n) < 0).concat(bx.add || []);
    if (bx.meta) g.BAN_META = Object.assign({}, g.BAN_META, bx.meta);
  }
  const sx = rj('spots-extra');
  if (sx) Object.keys(sx).forEach(k => { if (k[0] !== '_') g.SPOTS[k] = (g.SPOTS[k]||[]).concat(sx[k]); });
})();

const SEA = { W:'서해', S:'남해', E:'동해', J:'제주' };
const FLOOR = g.FLOOR_KO || { sand:'모래', mud:'펄', rock:'암반', mix:'혼합', none:'' };
const MON = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

/* ── 어종 ── */
const speciesMap = {};
function addSp(name, kind){
  if (!name) return;
  if (!speciesMap[name]) speciesMap[name] = { n:name, kind:kind, spots:[], season:null, ban:null, rig:null };
  else if (speciesMap[name].kind !== kind) speciesMap[name].kind = 'both';
}

(g.POINTS || []).forEach(p => {
  const h = (p.sp || (g.SP_DEFAULT||{})[p.s+'|'+p.f] || (g.SP_DEFAULT||{})[p.s+'|rock'] || []);
  const f = (p.fx || (g.FX_BY||{})[p.s+'|'+p.f] || (g.FX_DEFAULT||{})[p.s] || []);
  h.forEach(n => { addSp(n,'haeru'); speciesMap[n].spots.push(p.i); });
  f.forEach(n => { addSp(n,'fish');  speciesMap[n].spots.push(p.i); });
});

// 채비 사전에만 있고 지점 배정이 없는 종도 도감에 넣는다 — 검색 유입은 많을수록 좋다
Object.keys(g.RIGS || {}).forEach(n => {
  if (!speciesMap[n]){
    const isFish = !!(g.SEASON_FX && g.SEASON_FX[n]);
    speciesMap[n] = { n:n, kind: isFish ? 'fish' : 'haeru', spots:[], season:null, ban:null, rig:null };
  }
});

// 제철 달력
Object.keys(speciesMap).forEach(n => {
  const cal = (g.SEASON_SP && g.SEASON_SP[n]) || (g.SEASON_FX && g.SEASON_FX[n]) || null;
  if (cal) speciesMap[n].season = cal;
  if (g.RIGS && g.RIGS[n]) speciesMap[n].rig = g.RIGS[n];
});

// 금어기 — 이름 또는 별칭이 맞는 규정
(g.BANS || []).forEach(b => {
  const names = [b.n].concat(b.a || []);
  names.forEach(nm => {
    if (speciesMap[nm] && !speciesMap[nm].ban) speciesMap[nm].ban = b;
  });
});

/* ── 지점 ── */
const points = (g.POINTS || []).map(p => {
  const h = (p.sp || (g.SP_DEFAULT||{})[p.s+'|'+p.f] || (g.SP_DEFAULT||{})[p.s+'|rock'] || []);
  const f = (p.fx || (g.FX_BY||{})[p.s+'|'+p.f] || (g.FX_DEFAULT||{})[p.s] || []);
  return {
    i:p.i, n:p.n, r:p.r||'', sea:SEA[p.s]||'', seaCode:p.s,
    la:p.la, lo:p.lo, mr:p.mr, floor:FLOOR[p.f]||'', floorCode:p.f,
    isl:!!p.isl, fr:p.fr||null, tag:p.tag||'',
    haeru:h.slice(), fish:f.slice(),
    spots: (g.SPOTS && g.SPOTS[p.i]) ? g.SPOTS[p.i] : null
  };
});

const out = {
  generated: '2026-08-27',
  species: Object.values(speciesMap).sort((a,b)=>a.n.localeCompare(b.n,'ko')),
  points: points.sort((a,b)=>a.n.localeCompare(b.n,'ko')),
  months: MON,
  safeKit: g.SAFE_KIT || [],
  banMeta: g.BAN_META || null,
  nonpro: g.NONPRO || []
};
fs.writeFileSync('atlas_data.json', JSON.stringify(out));
console.log('어종', out.species.length, '종 / 지점', out.points.length, '곳');
console.log('제철 달력 있는 어종:', out.species.filter(s=>s.season).length);
console.log('금어기 걸린 어종:', out.species.filter(s=>s.ban).length);
console.log('채비 정보 있는 어종:', out.species.filter(s=>s.rig).length);
console.log('세부 포인트 있는 지점:', out.points.filter(p=>p.spots).length);
console.log('섬:', out.points.filter(p=>p.isl).length);
