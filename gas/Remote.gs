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
