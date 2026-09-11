/**
 * 해루낚 — 조석 · 천문 엔진
 * 1순위: 바다타임(m.badatime.com) 파싱
 * 2순위: 국립해양조사원 오픈API (스크립트 속성에 KHOA_KEY 저장 시)
 * 3순위: 내장 조화 근사 계산 (외부 호출 없음, 항상 동작)
 */

var SYN = 29.530588853;      // 삭망월(일)
var LUNI_DAY = 24.8412;      // 태음일(시간)
var SEMI = 12.4206;          // 반일주조 주기(시간)
var MULTTAE = ['7물','8물','9물','10물','11물','12물','13물','조금','무시','1물','2물','3물','4물','5물','6물'];

function toJD_(d){ return d.getTime()/86400000 + 2440587.5; }

/** 해당 날짜 09시(한국시) 기준 월령 */
function moonAge_(y,m,d){
  var dt = new Date(Date.UTC(y, m-1, d, 3, 0, 0)); // KST 12시 = UTC 03시
  var age = ((toJD_(dt) - 2451550.26) % SYN + SYN) % SYN;
  return age;
}

/** 물때(서해 기준) */
function multtae_(age, sea){
  var lunarDay = Math.round(age) + 1;          // 음력 일자 근사(삭 당일=1일)
  if (lunarDay > 30) lunarDay = 30;
  var idx = (lunarDay - 1) % 15;
  if (sea && sea !== 'W') idx = (idx + 1) % 15;   // 남해·동해·제주는 한 물 앞선 표기
  return { name: MULTTAE[idx], idx: idx, lunarDay: lunarDay };
}

/** 달 밝기 0(그믐)~1(보름) */
function moonBright_(age){
  return (1 - Math.cos(2*Math.PI*age/SYN)) / 2;
}

/** 일출·일몰(한국시 소수 시간) */
function sunTimes_(y,m,d,lat,lon){
  var rad = Math.PI/180;
  var jd = toJD_(new Date(Date.UTC(y, m-1, d, 0,0,0)));
  var lw = -lon;
  var n = Math.round(jd - 2451545.0 - 0.0009 - lw/360);
  var Js = 2451545.0 + 0.0009 + lw/360 + n;
  var M = (357.5291 + 0.98560028*(Js - 2451545.0)) % 360;
  var C = 1.9148*Math.sin(M*rad) + 0.0200*Math.sin(2*M*rad) + 0.0003*Math.sin(3*M*rad);
  var lam = (M + C + 180 + 102.9372) % 360;
  var Jt = Js + 0.0053*Math.sin(M*rad) - 0.0069*Math.sin(2*lam*rad);
  var dec = Math.asin(Math.sin(lam*rad) * Math.sin(23.44*rad));
  var cosW = (Math.sin(-0.833*rad) - Math.sin(lat*rad)*Math.sin(dec)) / (Math.cos(lat*rad)*Math.cos(dec));
  if (cosW > 1) return { rise:null, set:null, noon:12 };     // 극야
  if (cosW < -1) return { rise:0, set:24, noon:12 };         // 백야
  var w = Math.acos(cosW)/rad;
  var f = function(J){ return ((J - Math.floor(jd)) * 24 + 9 + 12) % 24; }; // KST 변환
  return { rise: f(Jt - w/360), set: f(Jt + w/360), noon: f(Jt) };
}

/** 달 남중(한국시 소수 시간) */
function moonTransit_(age, lon){
  var solarNoon = 12 + (135 - lon)/15;
  return ((solarNoon + age * (LUNI_DAY - 24)) % LUNI_DAY + LUNI_DAY) % LUNI_DAY;
}

/**
 * 내장 조석 근사 — 하루치 만조·간조 목록
 * @return {events:[{k:'H'|'L', t:시각(소수), lv:조위cm}], range:조차(m), src:'calc'}
 */
function calcTide_(p, y, mo, d){
  var age = moonAge_(y, mo, d);
  // 조석 지연(age of tide): 사리는 삭·망 당일이 아니라 약 하루 뒤에 온다
  var eff = age - 1.0;
  var phase = 2*Math.PI*eff/SYN;
  var sf = 1 + 0.447*Math.cos(2*phase);                       // 실측 대조로 보정한 계수
  var anom = 1 + 0.05*Math.cos(2*Math.PI*(eff+3)/27.5545);    // 근지점 보정(근사)
  var range = p.mr * sf * anom * 0.94;                        // m
  var msl = p.mr * 100 * 0.78;                           // 평균해면 cm
  var half = range * 100 / 2;

  var base = moonTransit_(age, p.lo) + p.hi;             // 첫 만조
  var ev = [];
  for (var k = -2; k <= 3; k++){
    var th = base + k*SEMI;
    if (th >= 0 && th < 24) ev.push({k:'H', t:th, lv: Math.round(msl + half)});
    var tl = base + k*SEMI + SEMI/2;
    if (tl >= 0 && tl < 24) ev.push({k:'L', t:tl, lv: Math.round(msl - half)});
  }
  ev.sort(function(a,b){ return a.t - b.t; });
  return { events: ev, range: range, src: 'calc' };
}

/** 바다타임 월간 물때표 파싱 → { 'YYYY-MM-DD': {events, range, src:'badatime', mul, weather} } */
function fetchBadatime_(pointId){
  var cache = CacheService.getScriptCache();
  var key = 'bt_' + pointId;
  var hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch(e){} }

  // 상태 점검 루프가 세운 우회 깃발 — 죽은 소스에 12시간 동안 재시도하지 않는다
  try {
    var down = PropertiesService.getScriptProperties().getProperty('BT_DOWN');
    if (down && Date.now() - Number(down) < 43200000) return null;
  } catch(e){}

  var html;
  try {
    var res = UrlFetchApp.fetch('https://m.badatime.com/' + pointId + '.html', {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' }
    });
    if (res.getResponseCode() !== 200) return null;
    html = res.getContentText('UTF-8');
  } catch(e){ return null; }

  var out = parseBadatime_(html);
  if (!out || !Object.keys(out).length) return null;
  try { cache.put(key, JSON.stringify(out), 21600); } catch(e){}
  return out;
}

/** 우회 깃발을 무시하고 실제로 받아본다 — 상태 점검 전용 */
function fetchBadatimeRaw_(pointId){
  var res = UrlFetchApp.fetch('https://m.badatime.com/' + pointId + '.html', {
    muteHttpExceptions: true, followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' }
  });
  if (res.getResponseCode() !== 200) return null;
  return parseBadatime_(res.getContentText('UTF-8'));
}

/**
 * 바다타임 물때표 HTML 파서.
 * 표 한 행: 일(요일) (월령) N물 [날씨] 만조시각(조위) 만조시각(조위) 간조시각(조위) 간조시각(조위)
 * 사이트 구조가 바뀌어도 죽지 않도록 태그를 지우고 텍스트 패턴으로 추출한다.
 */
function parseBadatime_(html){
  var ym = html.match(/(20\d{2})\s*년?\s*[-.\/]?\s*(\d{1,2})\s*월/);
  var now = new Date();
  var year  = ym ? parseInt(ym[1],10) : now.getFullYear();
  var month = ym ? parseInt(ym[2],10) : (now.getMonth()+1);

  var rows = html.split(/<tr[^>]*>/i);
  var out = {};
  for (var r=0; r<rows.length; r++){
    var txt = rows[r]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!txt) continue;

    var dm = txt.match(/^(\d{1,2})\s*\(\s*([월화수목금토일])\s*\)/);
    if (!dm) continue;
    var day = parseInt(dm[1],10);
    if (day < 1 || day > 31) continue;

    var mm = txt.match(/(\d{1,2}\s*물|조금|무시|무거|한객기|아치조금)/);
    var mulName = mm ? mm[1].replace(/\s+/g,'') : null;

    // 시각(조위) 쌍을 순서대로 추출 — 앞 두 개가 만조, 뒤 두 개가 간조
    var pairs = [], pm, re = /(\d{1,2}):(\d{2})\s*\(\s*(-?\d{1,4})\s*\)/g;
    while ((pm = re.exec(txt)) !== null){
      pairs.push({ t: parseInt(pm[1],10) + parseInt(pm[2],10)/60, lv: parseInt(pm[3],10) });
    }
    if (pairs.length < 2) continue;

    // 조위 크기로 만조·간조 판정 (표 순서에 의존하지 않음)
    var lv = pairs.map(function(x){ return x.lv; });
    var mid = (Math.max.apply(null,lv) + Math.min.apply(null,lv)) / 2;
    var events = pairs.map(function(x){ return { k: (x.lv >= mid ? 'H' : 'L'), t: x.t, lv: x.lv }; });
    events.sort(function(a,b){ return a.t - b.t; });

    var hi = Math.max.apply(null, lv), lo = Math.min.apply(null, lv);
    var ds = year + '-' + ('0'+month).slice(-2) + '-' + ('0'+day).slice(-2);
    out[ds] = { events: events, range: (hi-lo)/100, src: 'badatime', mul: mulName };
  }
  return out;
}

/** 국립해양조사원 오픈API (선택) */
function fetchKhoa_(p, ds){
  var key = PropertiesService.getScriptProperties().getProperty('KHOA_KEY');
  if (!key || !p.khoa) return null;
  try {
    var url = 'http://www.khoa.go.kr/api/oceangrid/tideObsPreTab/search.do?ServiceKey=' + key +
              '&ObsCode=' + p.khoa + '&Date=' + ds.replace(/-/g,'') + '&ResultType=json';
    var r = UrlFetchApp.fetch(url, {muteHttpExceptions:true});
    if (r.getResponseCode() !== 200) return null;
    var j = JSON.parse(r.getContentText());
    var list = j.result && j.result.data;
    if (!list || !list.length) return null;
    var ev = list.map(function(x){
      var hm = String(x.tph_time).split(' ')[1] || '00:00';
      var a = hm.split(':');
      return { k: (x.hl_code === '고조' || x.hl_code === 'H') ? 'H' : 'L',
               t: parseInt(a[0],10) + parseInt(a[1],10)/60, lv: Math.round(Number(x.tph_level)) };
    });
    ev.sort(function(a,b){ return a.t-b.t; });
    var lv = ev.map(function(x){return x.lv;});
    return { events: ev, range: (Math.max.apply(null,lv)-Math.min.apply(null,lv))/100, src:'khoa' };
  } catch(e){ return null; }
}

/** 지점·날짜 조석 (정밀 요청 시 외부 소스 사용) */
function tideOf_(p, ds, precise){
  if (precise){
    var bt = fetchBadatime_(p.i);
    if (bt && bt[ds]) return bt[ds];
    var kh = fetchKhoa_(p, ds);
    if (kh) return kh;
  }
  var a = ds.split('-');
  return calcTide_(p, +a[0], +a[1], +a[2]);
}
