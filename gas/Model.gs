/**
 * 해루낚 — 물리·생태 모형 엔진
 *
 * 점수를 감으로 매기지 않고 아래 모형을 실제로 계산해서 낸다.
 *  1. 선형파 이론      — 파랑이 바닥을 얼마나 흔드는가
 *  2. 재부유 임계      — 그 바닥이 실제로 뜨는가
 *  3. 광 감쇠          — 뜬 흙이 물속 시야를 얼마나 잡아먹는가
 *  4. 조류 유속        — 조차와 조석 위상으로 유속을 낸다
 *  5. 달 위치·솔루나   — 달 남중·하중·월출·월몰의 활성 주기
 *  6. 월광 조도        — 밤에 실제로 얼마나 밝은가 (럭스)
 *  7. 어종 수온 적정   — 종별 사다리꼴 적합도 곡선
 *  8. 기압 경향        — 하강 국면에서 활성이 오른다
 *  9. 갯벌 노출 폭     — 조위 낙차와 갯벌 경사로 드러나는 거리
 * 10. 박명            — 피딩타임의 실제 경계
 */

var G_ACC = 9.80665;

/* ══════════ 1. 선형파 이론 ══════════ */
/** 분산관계 ω² = g·k·tanh(kh) 를 뉴턴 반복으로 풀어 파장을 구한다 */
function waveLength_(T, h){
  if (!T || T <= 0 || !h || h <= 0) return 0;
  var w = 2*Math.PI/T;
  var k = w*w/G_ACC;                       // 심해 근사에서 출발
  for (var n = 0; n < 30; n++){
    var th = Math.tanh(k*h);
    var f  = G_ACC*k*th - w*w;
    var df = G_ACC*th + G_ACC*k*h*(1 - th*th);
    if (Math.abs(df) < 1e-12) break;
    var dk = f/df;
    k -= dk;
    if (k <= 0){ k = w*w/G_ACC; break; }
    if (Math.abs(dk) < 1e-10) break;
  }
  return 2*Math.PI/k;
}
/** 해저 최대 궤도속도 u_b = πH / (T·sinh(kh))  [m/s] */
function bedOrbitalVel_(H, T, h){
  if (!H || H <= 0 || !T || T <= 0 || !h || h <= 0) return 0;
  var L = waveLength_(T, h);
  if (!L) return 0;
  var s = Math.sinh(2*Math.PI*h/L);
  if (s < 1e-6) return 0;
  return Math.PI*H/(T*s);
}

/* ══════════ 2. 재부유 임계 ══════════ */
/** 바닥질별 재부유 임계 유속(m/s) — 조간대 생물막을 감안해 실험값보다 높게 잡았다 */
var U_CRIT   = { mud:0.20, mix:0.25, sand:0.26, rock:0.50, none:0.24 };
/** 잔잔할 때의 기본 부유물 농도(mg/L) */
var SSC_BASE = { mud:30,   mix:14,   sand:8,    rock:2.5,  none:11  };
/** 조간대 작업 수심(m) — 해루질은 무릎~허리 */
var WORK_DEPTH = { mud:1.0, mix:1.2, sand:1.2, rock:1.8, none:1.5 };

function resuspendIdx_(ub, floor){
  return ub / (U_CRIT[floor] || 0.24);
}

/* ══════════ 3. 수중 시야 ══════════ */
/**
 * 부유물 농도에서 광 감쇠를 거쳐 다이버 수평 시정을 추정한다.
 *   Kd = 0.04 + 0.045·SSC        (하방 감쇠계수)
 *   시정 ≈ 1.77 / Kd             (빔 감쇠 c ≈ 2.6·Kd, 시정 ≈ 4.6/c)
 * @param o {wave, period, floor, current, rain24, month, depth}
 * @return {vis, ssc, ub, R, kd, grade, word}
 */
function underwaterVis_(o){
  var floor = o.floor || 'mix';
  var h  = o.depth || WORK_DEPTH[floor] || 1.2;
  var H  = (o.wave === null || o.wave === undefined) ? 0.4 : o.wave;
  var T  = o.period || 5;
  var ub = bedOrbitalVel_(H, T, h);
  var R  = resuspendIdx_(ub, floor);

  var stir  = 1 + 3.5*Math.pow(Math.max(0, R - 1), 1.3);      // 바닥이 뜨는 정도
  var cur   = 1 + 0.55*Math.min(2.5, (o.current || 0)/0.35);  // 조류가 흙을 실어 나른다
  var rain  = 1 + Math.min(2.5, (o.rain24 || 0)/12);          // 육상 유출
  var m = o.month || 6;
  var bloom = (m >= 6 && m <= 9) ? 1.30 : (m >= 4 && m <= 5) ? 1.15 : 1.0;  // 부유생물·적조기

  var ssc = (SSC_BASE[floor] || 11) * stir * cur * rain * bloom;
  var kd  = 0.04 + 0.045*ssc;
  var vis = Math.max(0.12, Math.min(25, 1.77/kd));

  var grade, word;
  if (vis >= 6)        { grade = 'S'; word = '훤히 보임'; }
  else if (vis >= 2.5) { grade = 'A'; word = '맑음'; }
  else if (vis >= 1.2) { grade = 'B'; word = '보통'; }
  else if (vis >= 0.5) { grade = 'C'; word = '탁함'; }
  else                 { grade = 'D'; word = '거의 안 보임'; }

  return { vis: vis, ssc: ssc, ub: ub, R: R, kd: kd, grade: grade, word: word };
}

/* ══════════ 4. 조류 유속 ══════════ */
/**
 * 연안 정상파 가정 — 만조·간조 순간에 0, 그 중간에서 최대.
 * V최대(m/s) ≈ 0.055 × 조차(m) × 지형계수(kf)
 * kf 는 지점 데이터에 있으면 쓰고, 없으면 2.0 (열린 연안).
 */
function currentAt_(p, tide, hour){
  var ev = (tide.events || []).slice().sort(function(a,b){ return a.t - b.t; });
  if (ev.length < 2) return 0;
  var P = 6.2103, prev = null, next = null;
  for (var k = 0; k < ev.length - 1; k++){
    if (hour >= ev[k].t && hour <= ev[k+1].t){ prev = ev[k]; next = ev[k+1]; break; }
  }
  if (!prev){
    if (hour < ev[0].t){ prev = { t: ev[0].t - P }; next = ev[0]; }
    else { prev = ev[ev.length-1]; next = { t: prev.t + P }; }
  }
  var span = next.t - prev.t;
  if (span <= 0) return 0;
  var ph = (hour - prev.t)/span;
  var vmax = 0.055 * (tide.range || 0) * (p.kf || 2.0);
  return vmax * Math.sin(Math.PI*ph);          // m/s
}
function toKnot_(ms){ return ms * 1.943844; }

/* ══════════ 5. 달 위치와 솔루나 ══════════ */
var RAD = Math.PI/180;
/** 저정밀 달 적경·적위 (Meeus 축약형) */
function moonEq_(jd){
  var d = jd - 2451545.0;
  var L = (218.316 + 13.176396*d) * RAD;
  var M = (134.963 + 13.064993*d) * RAD;
  var F = ( 93.272 + 13.229350*d) * RAD;
  var lam = L + 6.289*RAD*Math.sin(M);
  var bet = 5.128*RAD*Math.sin(F);
  var dist = 385001 - 20905*Math.cos(M);
  var e = 23.4397*RAD;
  var ra  = Math.atan2(Math.sin(lam)*Math.cos(e) - Math.tan(bet)*Math.sin(e), Math.cos(lam));
  var dec = Math.asin(Math.sin(bet)*Math.cos(e) + Math.cos(bet)*Math.sin(e)*Math.sin(lam));
  return { ra: ra, dec: dec, dist: dist };
}
function gmst_(jd){ return (280.16 + 360.9856235*(jd - 2451545.0)) * RAD; }
/** 달 고도(라디안) — 대기굴절 근사 포함 */
function moonAlt_(jd, lat, lon){
  var m = moonEq_(jd);
  var H = gmst_(jd) + lon*RAD - m.ra;
  var la = lat*RAD;
  var sinAlt = Math.sin(la)*Math.sin(m.dec) + Math.cos(la)*Math.cos(m.dec)*Math.cos(H);
  var alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  if (alt > -0.05) alt += 0.0029/Math.tan(alt + 0.0032/(alt + 0.089));  // 굴절
  return alt;
}
/** 한국시 소수시각 → 율리우스일 */
function jdOf_(y, mo, d, kstHour){
  return Date.UTC(y, mo-1, d, 0, 0, 0)/86400000 + 2440587.5 + (kstHour - 9)/24;
}
/**
 * 하루치 달 궤적을 훑어 남중·하중·월출·월몰을 찾는다.
 * @return {transit, antiTransit, rise, set}  (한국시 소수시각, 없으면 null)
 */
function moonEvents_(y, mo, d, lat, lon){
  var alt = [], k;
  for (k = 0; k <= 48; k++) alt.push(moonAlt_(jdOf_(y, mo, d, k/2), lat, lon));
  var rise = null, set = null, transit = null, anti = null, best = -9, worst = 9;
  for (k = 0; k < 48; k++){
    var a = alt[k], b = alt[k+1];
    if (a < 0 && b >= 0 && rise === null) rise = (k + (-a)/(b-a))/2;
    if (a >= 0 && b < 0 && set  === null) set  = (k + a/(a-b))/2;
    if (a > best){ best = a; transit = k/2; }
    if (a < worst){ worst = a; anti = k/2; }
  }
  // 극점을 이웃 값으로 다듬는다
  function refine(t){
    if (t === null) return null;
    var lo = Math.max(0, t - 0.5), hi = Math.min(24, t + 0.5), bt = t, bv = -9;
    for (var x = lo; x <= hi; x += 0.05){
      var v = moonAlt_(jdOf_(y, mo, d, x), lat, lon);
      if (v > bv){ bv = v; bt = x; }
    }
    return bt;
  }
  return { rise: rise, set: set, transit: refine(transit), antiTransit: anti };
}
/**
 * 솔루나 — 달 남중·하중이 주 활성기(±1시간), 월출·월몰이 보조 활성기(±0.6시간).
 * 삭·망 근처일수록 강도가 올라간다.
 */
function solunar_(y, mo, d, lat, lon, age){
  var e = moonEvents_(y, mo, d, lat, lon);
  var major = [], minor = [];
  if (e.transit !== null)     major.push([e.transit - 1.0, e.transit + 1.0]);
  if (e.antiTransit !== null) major.push([e.antiTransit - 1.0, e.antiTransit + 1.0]);
  if (e.rise !== null) minor.push([e.rise - 0.6, e.rise + 0.6]);
  if (e.set  !== null) minor.push([e.set  - 0.6, e.set  + 0.6]);
  // 삭(0) 또는 망(14.77)에 가까울수록 1에 근접
  var toNew  = Math.min(age, SYN - age);
  var toFull = Math.abs(age - SYN/2);
  var near   = Math.min(toNew, toFull);
  var strength = Math.max(0.35, 1 - near/5.5);
  return { major: major, minor: minor, strength: strength, ev: e };
}
/** 특정 시각이 활성기에 얼마나 걸쳐 있는가 0~1 */
function solunarAt_(sol, hour){
  var best = 0;
  function chk(w, weight){
    for (var k = 0; k < w.length; k++){
      var a = w[k][0], b = w[k][1];
      for (var sh = -24; sh <= 24; sh += 24){
        var h = hour + sh;
        if (h >= a && h <= b){
          var mid = (a+b)/2, half = (b-a)/2;
          var v = (1 - Math.abs(h - mid)/half*0.45) * weight;
          if (v > best) best = v;
        }
      }
    }
  }
  chk(sol.major, 1.0);
  chk(sol.minor, 0.62);
  return best * sol.strength;
}

/* ══════════ 6. 월광 조도 ══════════ */
/** 밤하늘 조도(럭스). 보름달 천정이 약 0.32럭스, 별빛 바닥은 0.0015럭스 */
function moonLux_(y, mo, d, hour, lat, lon, age){
  var jd = jdOf_(y, mo, d, hour);
  var alt = moonAlt_(jd, lat, lon);
  if (alt <= 0) return 0.0015;
  var f = (1 - Math.cos(2*Math.PI*age/SYN))/2;              // 밝은 면 비율
  var dist = moonEq_(jd).dist;
  var lux = 0.32 * Math.pow(f, 2.0) * Math.sin(alt) * Math.pow(384400/dist, 2);
  return Math.max(0.0015, lux);
}
function luxWord_(lux){
  if (lux >= 0.15) return '보름달급 — 랜턴 없이도 걷는다';
  if (lux >= 0.05) return '반달급 — 지형은 보인다';
  if (lux >= 0.01) return '어스름 — 랜턴 필수';
  return '칠흑 — 문어·낙지에 유리';
}

/* ══════════ 7. 어종 수온 적정 곡선 ══════════ */
/** [생존하한, 적정하한, 적정상한, 생존상한] °C */
var THERMAL = {
  '우럭':[2,9,20,26], '조피볼락':[2,9,20,26], '광어':[7,13,22,27], '넙치':[7,13,22,27],
  '놀래미':[4,10,20,25], '쥐노래미':[4,10,20,25], '농어':[8,14,24,28],
  '참돔':[9,15,24,28], '감성돔':[6,12,23,28], '돌돔':[12,18,26,30], '벵에돔':[11,17,26,30],
  '볼락':[3,8,17,23], '부시리':[13,18,26,30], '방어':[9,14,22,27],
  '대구':[1,3,10,14], '명태':[0,2,8,12], '갈치':[15,19,27,30], '삼치':[13,18,26,30],
  '전어':[12,18,27,31], '학공치':[6,10,20,25], '숭어':[5,12,25,31],
  '망둥어':[6,14,27,32], '가자미':[2,7,18,24], '임연수':[1,4,13,18], '도루묵':[1,3,11,16],
  '갑오징어':[11,16,25,29], '주꾸미':[10,15,24,28], '무늬오징어':[14,19,27,30],
  '한치':[15,20,28,31], '오징어':[10,14,22,27], '자리돔':[15,20,28,31],
  '문어':[6,11,19,24], '낙지':[8,15,26,30], '양태':[8,14,26,30], '대게':[0,2,8,12], '멸치':[13,17,25,29],
  '고등어':[12,17,25,29], '붕장어':[9,15,25,29], '보리멸':[15,19,27,30],
  // 해루질 채집물
  '박하지':[8,15,26,30], '꽃게':[9,15,26,30], '바지락':[3,10,24,30], '백합':[6,13,26,31],
  '대합':[4,11,25,30], '맛조개':[5,12,24,29], '동죽':[5,12,25,30], '가무락':[4,11,24,29],
  '소라':[6,12,24,29], '고둥':[5,11,24,29], '보말':[8,13,25,29], '뿔소라':[9,14,25,29],
  '오분자기':[10,15,25,29], '전복':[6,12,23,28], '해삼':[1,5,16,22], '성게':[8,13,24,28],
  '개불':[3,8,20,26], '칠게':[8,15,28,33], '짱뚱어':[13,19,30,34], '꼬막':[4,10,24,30],
  '굴':[2,7,22,28], '홍합':[2,7,20,26], '따개비':[4,10,24,30], '거북손':[8,14,25,30],
  '군소':[9,14,24,28], '개조개':[5,11,24,29], '키조개':[6,12,24,29], '새조개':[3,8,18,24],
  '대하':[11,16,26,30], '밴댕이':[12,17,26,30], '미역':[1,4,15,20]
};
/** 0~1 사다리꼴 적합도 */
function thermalFit_(name, sst){
  if (sst === null || sst === undefined) return 0.65;
  var t = THERMAL[name];
  if (!t) return 0.65;
  if (sst <= t[0] || sst >= t[3]) return 0;
  if (sst >= t[1] && sst <= t[2]) return 1;
  if (sst < t[1]) return (sst - t[0])/(t[1] - t[0]);
  return (t[3] - sst)/(t[3] - t[2]);
}

/* ══════════ 8. 기압 경향 ══════════ */
/** 하루 배열에서 해당 시각 앞뒤 기울기(hPa/12h). 음수면 하강 국면 */
function pressTrend_(arr, hour){
  if (!arr || !arr.length) return 0;
  var i = Math.max(0, Math.min(arr.length-1, Math.round(hour)));
  var a = arr[Math.max(0, i-6)], b = arr[Math.min(arr.length-1, i+6)];
  if (a === null || b === null || a === undefined || b === undefined) return 0;
  return b - a;
}
/** 완만한 하강이 가장 좋다. 급강하는 악천후라 오히려 나쁘다 */
function pressScore_(dp){
  if (dp === null || dp === undefined) return 0.6;
  if (dp <= -9) return 0.25;
  if (dp <= -2) return 1.0;
  if (dp <= 0)  return 0.85;
  if (dp <= 3)  return 0.6;
  return 0.4;
}

/* ══════════ 9. 갯벌 노출 폭 ══════════ */
/** 바닥질별 평균 경사 (수직/수평) */
var FLAT_SLOPE = { mud:0.0009, mix:0.0022, sand:0.0040, rock:0.020, none:0.05 };
/** 평균해면에서 저조위까지 떨어질 때 드러나는 수평 거리(m) */
function flatWidth_(mslCm, lowCm, floor){
  var drop = Math.max(0, (mslCm - lowCm))/100;
  return drop / (FLAT_SLOPE[floor] || 0.003);
}

/* ══════════ 10. 해안 방위와 바람 방향 ══════════ */
/**
 * 그 자리가 바라보는 바다 방향(방위각, 도).
 * 지점에 az 가 있으면 그것을, 없으면 해역별 근사값을 쓴다.
 * 제주는 섬 중심에서 바깥쪽을 향한 각도로 계산한다.
 */
function shoreAz_(p){
  if (p.az !== undefined && p.az !== null) return p.az;
  if (p.s === 'J'){
    var dy = p.la - 33.37, dx = p.lo - 126.53;
    return ((Math.atan2(dx, dy) * 180/Math.PI) + 360) % 360;   // 중심→지점 = 바다쪽
  }
  return { W: 270, S: 180, E: 90 }[p.s] || 180;
}
/**
 * 바람이 그 자리에 어떻게 걸리는가.
 * wdir 는 바람이 "불어오는" 방향이므로, 바다쪽(az)에서 불어오면 맞바람(온쇼어)이다.
 * @return { on: -1(등바람)~+1(맞바람), word }
 */
function windOnshore_(p, wdir){
  if (wdir === null || wdir === undefined) return { on: 0, word: '' };
  var az = shoreAz_(p);
  var diff = Math.abs(((wdir - az) % 360 + 540) % 360 - 180);  // 0=같은 방향(바다쪽), 180=정반대
  var on = Math.cos(diff * Math.PI/180);                       // +1 맞바람, -1 등바람
  var word = on > 0.5 ? '맞바람' : on < -0.5 ? '등바람' : '옆바람';
  return { on: on, word: word };
}
/**
 * 낚시 관점 바람 종합.
 *  - 등바람: 캐스팅 편하고 발밑 잔잔 — 체감 풍속을 깎아준다
 *  - 약한 맞바람(2~6m/s): 용존산소·베이트가 몰려 활성에 오히려 가점
 *  - 강한 맞바람: 파도가 발밑을 때리고 채비가 안 날아간다 — 크게 감점
 * @return { eff: 체감 풍속, bonus: 활성 가점 0~1, wo }
 */
function windEffect_(p, wind, wdir){
  var wo = windOnshore_(p, wdir);
  if (wind === null || wind === undefined) return { eff: wind, bonus: 0.5, wo: wo };
  var eff = wind * (0.55 + 0.45 * (wo.on + 1) / 2 * 1.6);      // 등바람 0.55배 ~ 맞바람 1.27배
  var bonus = 0.5;
  if (wo.on > 0.3 && wind >= 2 && wind <= 6) bonus = 0.85;      // 알맞은 맞바람
  else if (wo.on > 0.3 && wind > 9) bonus = 0.15;               // 사나운 맞바람
  else if (wo.on < -0.3) bonus = 0.45;                          // 등바람 — 편하지만 활성 무풍
  return { eff: eff, bonus: bonus, wo: wo };
}

/* ══════════ 11. 박명 ══════════ */
/** 태양 고도 alt(도)에 해당하는 시각. -0.833 일출·일몰, -6 시민박명 */
function sunAtAlt_(y, m, d, lat, lon, altDeg){
  var jd = toJD_(new Date(Date.UTC(y, m-1, d, 0,0,0)));
  var lw = -lon;
  var n = Math.round(jd - 2451545.0 - 0.0009 - lw/360);
  var Js = 2451545.0 + 0.0009 + lw/360 + n;
  var M = (357.5291 + 0.98560028*(Js - 2451545.0)) % 360;
  var C = 1.9148*Math.sin(M*RAD) + 0.0200*Math.sin(2*M*RAD) + 0.0003*Math.sin(3*M*RAD);
  var lam = (M + C + 180 + 102.9372) % 360;
  var Jt = Js + 0.0053*Math.sin(M*RAD) - 0.0069*Math.sin(2*lam*RAD);
  var dec = Math.asin(Math.sin(lam*RAD)*Math.sin(23.44*RAD));
  var cosW = (Math.sin(altDeg*RAD) - Math.sin(lat*RAD)*Math.sin(dec)) / (Math.cos(lat*RAD)*Math.cos(dec));
  if (cosW > 1 || cosW < -1) return { rise: null, set: null };
  var w = Math.acos(cosW)/RAD;
  var f = function(J){ return ((J - Math.floor(jd)) * 24 + 9 + 12) % 24; };
  return { rise: f(Jt - w/360), set: f(Jt + w/360) };
}
