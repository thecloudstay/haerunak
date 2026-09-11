/**
 * 해루낚 — 원격 데이터 계층
 *
 * 금어기·세부 포인트·지점 정보를 코드가 아니라 저장소의 data/*.json 에서 읽는다.
 * 깃허브에서 JSON 만 고치면 재배포 없이 반영된다 (앱스판 6시간 캐시, 사이트판 즉시).
 *
 * 설정: 스크립트 속성 DATA_BASE 에 사이트 주소를 넣는다.
 *   예) https://<계정>.github.io/haerunak
 * 비어 있으면 이 계층은 조용히 꺼지고 내장 자료만 쓴다.
 */

var REMOTE_CACHE_SEC = 21600;   // 6시간

function dataBase_(){
  try { return PropertiesService.getScriptProperties().getProperty('DATA_BASE') || ''; }
  catch(e){ return ''; }
}

function remoteJson_(name){
  var base = dataBase_();
  if (!base) return null;
  var cache = CacheService.getScriptCache(), k = 'rj_' + name;
  var hit = cache.get(k);
  if (hit){ try { return JSON.parse(hit); } catch(e){} }
  try {
    var r = UrlFetchApp.fetch(base.replace(/\/+$/,'') + '/data/' + name + '.json', { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return null;
    var j = JSON.parse(r.getContentText('UTF-8'));
    try { cache.put(k, JSON.stringify(j), REMOTE_CACHE_SEC); } catch(e){}
    return j;
  } catch(e){ return null; }
}

/** 지점 추가·수정 — data/points-extra.json {"points":[{i,n,la,lo,...}]}
 *  같은 번호가 있으면 내장 지점 위에 덮어쓴다(부분 수정 가능). */
function pool_(){
  var j = remoteJson_('points-extra');
  var ex = (j && j.points) || [];
  if (!ex.length) return POINTS;
  var map = {}, out = [];
  POINTS.forEach(function(p){ map[p.i] = p; });
  ex.forEach(function(p){
    if (!p || !p.i) return;
    map[p.i] = map[p.i] ? Object.assign({}, map[p.i], p) : p;
  });
  for (var k in map){
    var p = map[k];
    if (p.la && p.lo && p.mr !== undefined) out.push(p);
  }
  return out;
}

/** 금어기 보정 — data/ban-extra.json {"add":[규칙],"remove":["이름"],"meta":{asOf,warn}} */
function effBans_(){
  var ex = remoteJson_('ban-extra');
  if (!ex) return { list: BANS, meta: BAN_META };
  var rm = ex.remove || [];
  var list = BANS.filter(function(r){ return rm.indexOf(r.n) < 0; }).concat(ex.add || []);
  return { list: list, meta: Object.assign({}, BAN_META, ex.meta || {}) };
}
function banMetaNow_(){ return effBans_().meta; }

/** 세부 포인트 추가 — data/spots-extra.json {"151":[{n,t,d,w}], ...} */
function spotsExtra_(id){
  var j = remoteJson_('spots-extra');
  return (j && (j[String(id)] || j[id])) || [];
}

/** ── 해경 출입통제구역 — data/zones.json ──
 * {"zones":[{n,g,la,lo,why,period,src,poly:[[la,lo],..]?,est:1?}]}
 * 연안사고예방법 제10조에 따른 출입통제 장소. 위반 시 100만원 이하 과태료(제25조).
 * poly 가 있으면 공고 좌표(확정), est=1 이면 위치가 대략적이다. */
function zonesAll_(){
  var j = remoteJson_('zones');
  return (j && j.zones) || [];
}
function geoKm_(a, b, c, d){
  var R = 6371, r = Math.PI/180;
  var x = (c-a)*r, y = (d-b)*r;
  var h = Math.sin(x/2)*Math.sin(x/2) + Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)*Math.sin(y/2);
  return 2*R*Math.asin(Math.sqrt(h));
}
/** 지점 근처 통제구역 — 기본 반경 2.5km, 가까운 순 */
function zonesNear_(la, lo, km){
  km = km || 2.5;
  return zonesAll_().map(function(z){
    if (!z || !z.la || !z.lo) return null;
    var d = geoKm_(la, lo, z.la, z.lo);
    if (d > km) return null;
    return Object.assign({ km: Math.round(d*10)/10 }, z);
  }).filter(function(x){ return x; }).sort(function(a,b){ return a.km - b.km; });
}

/** ── 보호·제한구역 — data/protect.json ──
 * 습지보호지역·해양보호구역·국립공원·천연기념물은 원형(중심·반경km)으로 근사, 지자체 고시는 지역명으로.
 * 지점이 원 안(+0.3km 여유)이면 해당. 과태료·벌금이 걸리는 곳이라 상세와 목록에 반드시 띄운다. */
function protectNear_(p){
  var j = remoteJson_('protect');
  if (!j) return [];
  var kinds = j.kinds || {}, out = [];
  (j.areas || []).forEach(function(a){
    if (!a || a.la == null) return;
    var d = geoKm_(p.la, p.lo, a.la, a.lo);
    if (d > (a.r || 2) + 0.3) return;
    var k = kinds[a.k] || {};
    out.push({ n: a.n, k: a.k, t: k.t || '', law: k.law || '', rule: a.rule || k.rule || '', km: Math.round(d*10)/10, est: a.est ? 1 : 0 });
  });
  (j.regions || []).forEach(function(g){
    if (!g || !g.r) return;
    if (String(p.r || '').indexOf(g.r) < 0) return;
    var k = kinds[g.k] || {};
    out.push({ n: g.t || g.r, k: g.k, t: k.t || '', law: k.law || '', rule: g.rule || k.rule || '', km: 0, est: 0, region: 1 });
  });
  return out;
}

/** 섬 들어가는 길 — data/ferry.json {book,status,tel,portInfo,tips}
 *  예약처가 바뀌거나 전화번호가 생기면 이 파일만 고치면 된다. */
var FERRY_FALLBACK = {
  /* 2025-04-01 '가보고싶은섬'(island.haewoon.co.kr) 종료 → 한국해운조합으로 통합됨.
     바깥 링크는 죽으면 신뢰를 깎으므로 확인된 것만 남긴다. */
  book: [{ n:'한국해운조합 여객선예매', u:'https://island.theksa.co.kr/', note:'연안여객선 통합 예매 — 회원 9매·비회원 3매까지' }],
  status:[{ n:'실시간 운항현황', u:'https://www.komsa.or.kr/prog/dailyCurState/kor/sub03_0201/list.do', note:'해양교통안전공단 — 지금 뜨는지' },
          { n:'내일의 운항 예보', u:'https://www.komsa.or.kr/prog/tmmrwSailing/kor/sub03_0207/list.do', note:'전날 미리 확인' }],
  tel:  [{ n:'여객선 예매 고객센터', v:'1599-5985', note:'한국해운조합 · 옹진 항로는 2번' }],
  portInfo: {},
  tips: ['연안여객선은 신분증이 있어야 탑니다. 안 가져가면 못 탑니다.',
         '출항 30분 전까지는 매표소에 도착하세요.',
         '결항은 당일 아침에 결정되는 일이 많습니다. 출발 전 한 번 더 확인하세요.',
         '차를 싣는 배는 예약이 빨리 찹니다. 성수기·주말은 미리 잡으세요.']
};
function ferryInfo_(){
  var j = remoteJson_('ferry');
  if (!j) return FERRY_FALLBACK;
  return {
    book:     j.book     || FERRY_FALLBACK.book,
    status:   j.status   || FERRY_FALLBACK.status,
    tel:      j.tel      || FERRY_FALLBACK.tel,
    portInfo: j.portInfo || {},
    tips:     j.tips     || FERRY_FALLBACK.tips
  };
}

/** 실측 관측값 — data/obs.json 에서 그 자리와 가장 가까운 관측소 값을 꺼낸다.
 *  예보가 아니라 「지금 실제로 이랬다」는 값이라, 저기압·강풍으로 예보가 어긋난 날을 잡아낸다.
 *  자료가 없으면(키 미설정·수집 실패) null 을 돌려주고 화면은 지금 그대로 돈다. */
function obsNear_(p){
  var j = remoteJson_('obs');
  if (!j || !j.s) return null;
  var st = null;
  try { st = (remoteJson_('tide-stations') || {}).stations; } catch(e){}
  if (!st){
    try { st = TIDE_STATIONS; } catch(e){ st = null; }
  }
  if (!st || !st.length) return null;
  var best = null, bd = 1e9;
  for (var i = 0; i < st.length; i++){
    var s = st[i];
    if (!j.s[s.code]) continue;
    var d = Math.pow(s.la - p.la, 2) + Math.pow((s.lo - p.lo) * 0.79, 2);
    if (d < bd){ bd = d; best = s; }
  }
  if (!best) return null;
  var km = Math.round(Math.sqrt(bd) * 111);
  if (km > 60) return null;                 // 60km 넘게 떨어진 관측소 값은 그 자리 얘기가 아니다
  var v = j.s[best.code] || {};
  var wave = null;
  (j.wave || []).forEach(function(w){
    var d2 = Math.pow(w.la - p.la, 2) + Math.pow((w.lo - p.lo) * 0.79, 2);
    if (d2 < 1.0 && (!wave || d2 < wave._d)){ wave = { h: w.h, p: w.p, n: w.n, _d: d2 }; }
  });
  return {
    obs: best.name, km: km, at: j.at || v.at || null,
    lv: v.lv != null ? v.lv : null,          // 조위 cm
    tw: v.tw != null ? v.tw : null,          // 수온 ℃
    ws: v.ws != null ? v.ws : null,          // 풍속 m/s
    wv: wave ? wave.h : null,                // 파고 m
    wvn: wave ? wave.n : null
  };
}
