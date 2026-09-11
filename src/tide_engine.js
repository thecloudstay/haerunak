var SYN = 29.530588853;      // 삭망월(일)
var LUNI_DAY = 24.8412;      // 태음일(시간)
var SEMI = 12.4206;          // 반일주조 주기(시간)
var MULTTAE = ['7물','8물','9물','10물','11물','12물','13물','조금','무시','1물','2물','3물','4물','5물','6물'];
var REC_SET = {'6물':1,'7물':1,'8물':1,'9물':1};   // 해루질 추천 물때(조차 큰 사리권)
function toJD_(d){ return d.getTime()/86400000 + 2440587.5; }
function moonAge_(y,m,d){
  var dt = new Date(Date.UTC(y, m-1, d, 3, 0, 0)); // KST 12시 = UTC 03시
  var age = ((toJD_(dt) - 2451550.26) % SYN + SYN) % SYN;
  return age;
}
function multtae_(age, sea){
  var lunarDay = Math.round(age) + 1;
  if (lunarDay > 30) lunarDay = 30;
  var idx = (lunarDay - 1) % 15;
  if (sea && sea !== 'W') idx = (idx + 1) % 15;
  return { name: MULTTAE[idx], idx: idx, lunarDay: lunarDay };
}
function moonTransit_(age, lon){
  var solarNoon = 12 + (135 - lon)/15;
  return ((solarNoon + age * (LUNI_DAY - 24)) % LUNI_DAY + LUNI_DAY) % LUNI_DAY;
}
function calcTide_(p, y, mo, d){
  var age = moonAge_(y, mo, d);
  var eff = age - 1.0;
  var phase = 2*Math.PI*eff/SYN;
  var sf = 1 + 0.447*Math.cos(2*phase);
  var anom = 1 + 0.05*Math.cos(2*Math.PI*(eff+3)/27.5545);
  var range = p.mr * sf * anom * 0.94;
  var msl = p.mr * 100 * 0.78;
  var half = range * 100 / 2;
  var base = moonTransit_(age, p.lo) + p.hi;
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
