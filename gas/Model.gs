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
/** 잔잔할 때의 기본 부유물 농도(mg/L) — 남해 기준 표다 */
var SSC_BASE = { mud:30,   mix:14,   sand:8,    rock:2.5,  none:11  };
/** 해역 보정 — 같은 갯바위라도 서해와 제주는 물이 다르다.
 *  해양환경정보포털 수질평가지수의 해역별 투명도 기준값
 *  (동해 8.5m · 대한해협 2.5m · 서해중부 1.0m · 제주 8.0m)을
 *  소광식으로 역산해 부유물질 농도로 환산한 비율이다.
 *  환산된 서해 24.2mg/L 는 서해안 갯벌 해역 실측 평균 24.3mg/L 와 거의 같다. */
var SEA_TURB = { W:2.8, S:1.0, E:0.15, J:0.18 };
/** 해역별 시야 상한(m) — 계수가 어긋나도 헛소리가 나가지 않게 마지막에 거는 빗장 */
var VIS_CAP  = { W:5, S:12, E:20, J:25 };
/** 세키 깊이 → 수평 시야 환산. 탁할수록 수평이 더 나빠진다 */
function horizRatio_(secchi){
  var t = Math.max(0, Math.min(1, (secchi - 1) / 9));
  return 0.46 + 0.30 * t;                 // 탁수 0.46 ~ 청수 0.76
}
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
/* 부유물 농도 하나로 시야를 내는 공통 경로 — 오늘값과 띠 계산이 같은 식을 쓴다 */
function visFromSSC_(ssc, sea){
  var kd = 0.12 + 0.065*ssc;
  var secchi = 1.7/kd;
  return Math.max(0.03, Math.min(VIS_CAP[sea] || 12, secchi * horizRatio_(secchi)));
}
/* 그 자리(해역×바닥질×달)에서 기대할 수 있는 시야 폭.
 *   최선: 정조·무풍·무강우          최악: 파랑이 바닥을 뒤집고 조류·비가 겹친 날(교란 8배)
 * 「서해치고 맑은 날인가」는 이 띠 안에서 오늘이 어디 있는지로 잰다.
 * 절대 미터로 재면 서해 펄은 일 년 내내 꼴찌라 아무것도 가려내지 못한다. */
function visBandFor_(floor, sea, month){
  var bloom = (month >= 6 && month <= 9) ? 1.30 : (month >= 4 && month <= 5) ? 1.15 : 1.0;
  var base = (SSC_BASE[floor] || 11) * (SEA_TURB[sea] || 1) * bloom;
  var hi = visFromSSC_(base, sea);
  var lo = visFromSSC_(base * 8, sea);
  if (lo >= hi) lo = hi * 0.5;
  return { lo: lo, hi: hi };
}

function underwaterVis_(o){
  var floor = o.floor || 'mix';
  var h  = o.depth || WORK_DEPTH[floor] || 1.2;
  var H  = (o.wave === null || o.wave === undefined) ? 0.4 : o.wave;
  var T  = o.period || 5;
  var ub = bedOrbitalVel_(H, T, h);
  var R  = resuspendIdx_(ub, floor);

  // 바닥이 뜨는 정도 — 상한 6배. 폭풍이라고 무한정 뜨는 게 아니라 어느 선에서 포화된다
  var stir  = Math.min(6, 1 + 3.5*Math.pow(Math.max(0, R - 1), 1.3));
  var cur   = 1 + 0.55*Math.min(2.5, (o.current || 0)/0.35);  // 조류가 흙을 실어 나른다
  var rain  = 1 + Math.min(2.5, (o.rain24 || 0)/12);          // 육상 유출
  var m = o.month || 6;
  var bloom = (m >= 6 && m <= 9) ? 1.30 : (m >= 4 && m <= 5) ? 1.15 : 1.0;  // 부유생물·적조기

  var sea = o.sea || 'S';
  // 상한 600mg/L — 폭풍 재부유 실측이 수백 mg/L 대이고, 그 위는 유동니(죽 같은 뻘물)라 시야 논의가 무의미하다
  var ssc = Math.min(600, (SSC_BASE[floor] || 11) * (SEA_TURB[sea] || 1) * stir * cur * rain * bloom);
  // 영국 연안 실측 회귀식 kd = 0.1155 + 0.0654·부유물질 (Devlin 외 2009)
  var kd  = 0.12 + 0.065*ssc;
  // 1.7/kd 는 수평 시야가 아니라 세키(투명도) 깊이다. 수평은 그보다 짧다
  var secchi = 1.7/kd;
  var vis = Math.max(0.03, Math.min(VIS_CAP[sea] || 12, secchi * horizRatio_(secchi)));

  var grade, word;
  if (vis >= 6)        { grade = 'S'; word = '훤히 보임'; }
  else if (vis >= 2.5) { grade = 'A'; word = '맑음'; }
  else if (vis >= 1.2) { grade = 'B'; word = '보통'; }
  else if (vis >= 0.5) { grade = 'C'; word = '탁함'; }
  else                 { grade = 'D'; word = '거의 안 보임'; }

  return { vis: vis, secchi: secchi, ssc: ssc, ub: ub, R: R, kd: kd, grade: grade, word: word };
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
  '대하':[11,16,26,30], '밴댕이':[12,17,26,30], '미역':[1,4,15,20],
  /* 2026-08 추가 — 문헌 확인분만 */
  '붉바리':[5,12,26,34], '피뿔고둥':[4,18,26,35]
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
/* 문헌 실측에서 도출한 값으로 고쳤다 (2026-08).
 *   펄   0.0013  곰소만 6m/6km=0.0010 과 강화 남단 9.3m/6km=0.0016 의 사이
 *   혼합 0.0027  천수만 황도 4.41m/1.65km, 보령 학성리 1.7m/600m
 *   모래 0.0060  모래갯벌 폭 약 1km, 서해 중부 대조 조차 약 6m
 *   암반 0.020   직접 실측 근거를 못 찾음. 종전값 유지
 * 근거: MDPI Water 17(23) 3361 · JMSE 11(9) 1697 · 한국해양학회지 학성리
 *       · 서울대 해양저서생태학연구실 · 해양환경정보포털 */
var FLAT_SLOPE = { mud:0.0013, mix:0.0027, sand:0.0060, rock:0.020, none:0.05 };
/* 안전 계산 전용 — 물가가 밀려오는 속도는 경사가 완만할수록 빠르다.
 * 퇴로 시각과 위험도는 「가장 불리한 쪽」으로 잡아야 하므로 종전의 완만한 값을 그대로 쓴다.
 * 드러나는 폭은 위의 실측값으로, 빠져나올 시간은 이 값으로 — 둘을 일부러 갈라 놓았다. */
var SAFE_SLOPE = { mud:0.0009, mix:0.0022, sand:0.0040, rock:0.020, none:0.05 };
function safeSlope_(floor){ return SAFE_SLOPE[floor] || FLAT_SLOPE[floor] || 0.003; }
/** 평균해면에서 저조위까지 떨어질 때 드러나는 수평 거리(m) */
function flatWidth_(mslCm, lowCm, floor){
  var drop = Math.max(0, (mslCm - lowCm))/100;
  return drop / (FLAT_SLOPE[floor] || 0.003);
}

/* ══════════ 9-2. 진입·퇴로 시각 ══════════
 *  갯벌은 "몇 시가 좋다"만으로는 안전하지 않다.
 *  물가까지 걸어 나가는 데 시간이 걸리고, 돌아올 때는 물이 쫓아온다.
 *  그래서 조위 곡선과 걷는 속도를 함께 풀어 진입 시각과 퇴로 시각을 낸다.
 *
 *  조위(저조 기준 상승고)  h(Δt) = (R/2)(1 − cos(π·Δt / 6.21))
 *  드러난 거리            E(t)  = max(0, (H − h) / 경사)
 *  사람 위치              pos(t) = 걷기속도 × 경과시간
 *  안전 조건              언제나  pos(t) + 여유 ≤ E(t)
 */

/** 바닥질별 도보 속도 (m/h) — 펄은 발이 빠져 느리다 */
var WADE_SPEED = { mud:2000, mix:2600, sand:3200, rock:1600, none:2600 };
/** 물가와 유지할 여유 거리(m) */
var WADE_CLEAR = 25;

/** 저조로부터 Δt 시간 떨어진 시점의 조위 상승고(m) */
function tideRise_(dtH, rangeM){
  var T = 6.21;                                  // 저조→만조 반주기(시간)
  var x = Math.min(1, Math.abs(dtH) / T);
  return (rangeM / 2) * (1 - Math.cos(Math.PI * x));
}

/**
 * 진입·퇴로 계산
 * @param lowT   저조 시각(소수 시간, 0~24)
 * @param rangeM 그날 조차(m)
 * @param floor  바닥질 키 (mud/mix/sand/rock)
 * @param widthM 저조 때 드러나는 폭(m)
 * @return {inT, outT, dist, speed, walkMin, workMin, tight, why}
 */
/** 목표 작업 시간(분) — 이만큼도 못 있을 거면 그 거리는 의미가 없다 */
var WADE_TARGET = 90;
var WADE_DMIN   = 80;

function wadePlan_(lowT, rangeM, floor, widthM){
  if (lowT === null || lowT === undefined) return null;
  var v     = WADE_SPEED[floor] || 2600;
  var slope = safeSlope_(floor);            // 퇴로는 불리한 쪽으로 잡는다
  var H     = Math.max(0, widthM) * slope;
  if (!(H > 0)) return null;

  function E(t){
    var h = tideRise_(t - lowT, rangeM);
    return Math.max(0, (H - h) / slope);
  }
  var STEP = 1/12;

  /* 거리 D 를 정하면 진입·퇴로 시각이 정해진다 */
  function windowFor(D){
    function backOk(td){
      for (var t = td; t <= td + 6; t += STEP){
        var pos = D - v * (t - td);
        if (pos <= 0) return true;
        if (pos + WADE_CLEAR > E(t)) return false;
      }
      return true;
    }
    var outT = null;
    for (var td = lowT + 6; td >= lowT - 0.5; td -= STEP){ if (backOk(td)){ outT = td; break; } }

    function outOk(ti){
      for (var t = ti; t <= ti + 6; t += STEP){
        var pos = v * (t - ti);
        if (pos >= D) return true;
        if (pos + WADE_CLEAR > E(t)) return false;
      }
      return true;
    }
    var inT = null;
    for (var ti = lowT - 6; ti <= lowT + 0.5; ti += STEP){ if (outOk(ti)){ inT = ti; break; } }
    if (inT === null || outT === null) return null;

    var walkMin = Math.round(D / v * 60);
    var margin  = Math.min(0.5, 0.25 + walkMin / 600);
    outT = outT - margin;
    if (outT <= inT) return null;
    return {
      D: D, inT: inT, outT: outT, walkMin: walkMin, margin: margin,
      workMin: Math.round((outT - inT) * 60) - walkMin * 2
    };
  }

  /* ── 순서가 중요하다 ──
     예전에는 "걸어서 갈 수 있는 최대 거리"를 먼저 정하고 시간을 계산했다.
     그러면 갯벌 폭이 좁은 곳에서 맨 끝까지 나가라고 해 놓고
     "실제로 잡을 수 있는 시간 13분" 같은 말이 나온다. 쓸모가 없다.

     지금은 거꾸로 한다. 목표 작업 시간(90분)이 나오는
     '가장 먼' 거리를 고른다. 멀리 갈수록 좋지만 시간이 먼저다.        */
  var cap = Math.max(WADE_DMIN, Math.min(widthM, v * 0.42));
  var best = null, chosen = null;
  for (var D = cap; D >= WADE_DMIN; D -= 20){
    var w = windowFor(D);
    if (!w) continue;
    if (!best || w.workMin > best.workMin) best = w;
    if (w.workMin >= WADE_TARGET){ chosen = w; break; }
  }
  var r = chosen || best;
  if (!r) return null;

  var km = function(x){ return x >= 1000 ? (x/1000).toFixed(1) + 'km' : Math.round(x) + 'm'; };
  var why = '편도 ' + km(r.D) + ' 기준 · 걷는 데 한쪽 ' + r.walkMin + '분 · 안전 여유 '
          + Math.round(r.margin * 60) + '분을 뺐습니다';
  if (r.D < cap - 10)
    why += ' (저조 때는 ' + km(widthM) + '까지 드러나지만, 그만큼 나가면 머물 시간이 없어 '
         + km(r.D) + ' 로 잡았습니다)';
  else if (widthM > r.D * 1.25)
    why += ' (저조 때는 ' + km(widthM) + '까지 드러나지만 그렇게 멀리 나가면 물때에 걸립니다)';

  return {
    inT: (r.inT + 24) % 24,
    outT: (r.outT + 24) % 24,
    dist: Math.round(r.D),
    maxWidth: Math.round(widthM),
    speed: v,
    walkMin: r.walkMin,
    workMin: Math.max(0, r.workMin),
    tight: r.workMin < 40,
    why: why
  };
}

/* ══════════ 9-3. 지점 위험도 ══════════
 *  갯벌 고립사고가 왜 뻘에서만 나는지는 물리로 설명된다.
 *
 *  물이 드는 속도(수직)는 어디나 비슷하지만, 물가가 육지 쪽으로
 *  밀려오는 속도(수평)는 바닥 경사에 반비례한다.
 *  뻘은 경사가 1/1000 수준이라, 수직으로 1m 차는 동안
 *  물가는 수평으로 1km를 온다. 모래밭의 네 배가 넘는다.
 *
 *      h(t)  = (R/2)(1 - cos(pi·t/T))        조석 상승
 *      dh/dt = (R·pi / 2T)·sin(pi·t/T)       중간 물때에 최대
 *      물가 전진 속도 = (dh/dt) / 경사
 *
 *  이 값을 사람 걸음 속도로 나눈 것이 rho 다.
 *  rho 가 1을 넘으면 물이 들기 시작한 뒤에 걸어 나와서는 늦는다.
 *  서해 뻘은 조차 7m를 넘으면 rho 가 1을 넘는다. 인천·강화 대조가 여기다.
 *
 *  이 수치는 화면 경고에도 쓰고, 지점별 위험등급 자료로도 내보낸다.
 */
function riskOf_(rangeM, floor){
  var slope = safeSlope_(floor);            // 위험도도 불리한 쪽으로
  var walk  = WADE_SPEED[floor];
  if (!slope || !walk || !(rangeM > 0)) return null;

  var T = 6.21;
  var vWater = rangeM * Math.PI / (2 * T * slope);   // 물가 최대 전진 속도 (m/h)
  var rho    = vWater / walk;

  var grade, label, say;
  if (rho >= 1.0){
    grade = 4; label = '매우 높음';
    say = '중간 물때에는 물가가 걸음보다 빠릅니다. 물이 들기 시작하면 이미 늦습니다.';
  } else if (rho >= 0.6){
    grade = 3; label = '높음';
    say = '물가가 걸음 속도의 ' + Math.round(rho * 100) + '%로 따라옵니다. 여유를 넉넉히 두세요.';
  } else if (rho >= 0.3){
    grade = 2; label = '보통';
    say = '걸어서 빠져나올 수 있는 속도지만 갯골은 먼저 잠깁니다.';
  } else {
    grade = 1; label = '낮음';
    say = '경사가 있어 물가가 천천히 옵니다.';
  }

  return {
    rho: Math.round(rho * 100) / 100,
    water: Math.round(vWater),      // m/h
    walk: walk,                     // m/h
    slope: slope,
    grade: grade,                   // 1~4
    label: label,
    say: say
  };
}

/* ══════════ 9-4. 갯바위 처오름 ══════════
 *  갯바위 사고는 갯벌보다 많다. 최근 5년 638건, 사망 71명.
 *  그런데 원인이 다르다. 갯벌은 물때고, 갯바위는 너울이다.
 *
 *  사람들이 "갑자기 큰 파도가 왔다"고 하는 것은 착각이 아니다.
 *  파고는 유의파고(상위 1/3의 평균)라 개별 파는 그보다 크다.
 *  레일리 분포에서 1000파 중 최대파는 유의파고의 약 1.86배다.
 *
 *      Hmax ≈ 1.86 · Hs
 *      L0   = g·T² / 2π                      심해 파장
 *      ξ    = tanβ / √(Hmax/L0)              이리바렌 수
 *      R    = Hmax · ξ                        헌트(1959) 급경사 밀려오름
 *
 *  핵심은 주기다. 같은 파고 1m라도 주기 6초면 처오름 2.0m,
 *  14초면 4.8m가 된다. 파고만 보는 앱이 놓치는 자리가 여기다.
 *
 *  Hunt, I.A. (1959) Design of seawalls and breakwaters
 *  Longuet-Higgins, M.S. (1952) 파고의 통계 분포
 */
var ROCK_BETA = 0.20;        // 갯바위 앞면 경사 (약 11도)
var WAVE_MAX_RATIO = 1.86;   // 1000파 중 최대파 / 유의파고

function runupOf_(waveM, periodS){
  if (waveM === null || waveM === undefined) return null;
  if (periodS === null || periodS === undefined || !(periodS > 0)) return null;
  if (!(waveM > 0)) waveM = 0.1;

  var Hmax = WAVE_MAX_RATIO * waveM;
  var L0   = 9.81 * periodS * periodS / (2 * Math.PI);
  var xi   = ROCK_BETA / Math.sqrt(Hmax / L0);
  var R    = Hmax * Math.min(xi, 3.0);

  var grade, label, say;
  if (R >= 4.0){
    grade = 4; label = '매우 높음';
    say = '큰 파 하나가 ' + R.toFixed(1) + 'm까지 올라옵니다. 갯바위에 서 있을 높이가 아닙니다.';
  } else if (R >= 2.5){
    grade = 3; label = '높음';
    say = '드물게 오는 큰 파가 ' + R.toFixed(1) + 'm까지 칩니다. 발밑까지 옵니다.';
  } else if (R >= 1.5){
    grade = 2; label = '보통';
    say = '큰 파는 ' + R.toFixed(1) + 'm까지 올라옵니다. 낮은 자리는 피하세요.';
  } else {
    grade = 1; label = '낮음';
    say = '처오름 ' + R.toFixed(1) + 'm. 갯바위 높이면 대체로 넘지 않습니다.';
  }

  return {
    runup: Math.round(R * 10) / 10,        // 처오름 높이 (m)
    hs: Math.round(waveM * 100) / 100,     // 유의파고
    hmax: Math.round(Hmax * 10) / 10,      // 최대파
    period: Math.round(periodS * 10) / 10,
    wavelen: Math.round(L0),
    xi: Math.round(xi * 100) / 100,
    grade: grade,
    label: label,
    say: say,
    swell: periodS >= 9,                   // 장주기 너울
    ratio: Math.round(R / Math.max(0.1, waveM) * 10) / 10
  };
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

/* ══════════ 12. 하늘 상태 — 세계기상기구 기상코드 해석 ══════════ */
/**
 * 코드가 험할수록 순위가 높다. 하루 요약에서 "가장 험한 하늘"을 뽑는 데 쓴다.
 * 0 맑음 / 1~3 구름 / 45,48 안개 / 51~57 이슬비 / 61~65 비 / 66,67 얼어붙는 비
 * 71~77 눈 / 80~82 소나기 / 85,86 눈소나기 / 95,96,99 뇌우
 */
var SKY_RANK = {
  0:0, 1:1, 2:2, 3:3,
  45:6, 48:7,
  51:2, 53:3, 55:4, 56:6, 57:7,
  61:3, 63:5, 65:8, 66:8, 67:9,
  71:4, 73:6, 75:8, 77:5,
  80:4, 81:6, 82:9,
  85:6, 86:8,
  95:14, 96:15, 99:16
};

/**
 * 기상코드·시정·강수로 활동 위험을 판정한다.
 * @param code 세계기상기구 코드
 * @param vism 수평 시정(m)
 * @param rainH 그 시각 강수량(mm/h)
 * @param snowH 그 시각 적설(cm)
 * @return {storm, fog, freeze, snow, shower, word, level}
 */
function skyRisk_(code, vism, rainH, snowH){
  var c = (code === null || code === undefined) ? -1 : code;
  var r = {
    storm:  (c >= 95),
    freeze: (c === 66 || c === 67 || c === 56 || c === 57),
    snow:   (c >= 71 && c <= 77) || c === 85 || c === 86 || (snowH || 0) >= 0.3,
    shower: (c >= 80 && c <= 82),
    fog:    (c === 45 || c === 48) || (vism !== null && vism !== undefined && vism < 1000),
    word: '', level: 0
  };
  r.level = SKY_RANK[c] !== undefined ? SKY_RANK[c] : 0;
  if (r.fog && r.level < 6) r.level = 6;

  var rh = rainH || 0;
  if (r.storm)       r.word = '뇌우';
  else if (r.freeze) r.word = '얼어붙는 비';
  else if (r.snow)   r.word = '눈';
  else if (r.fog)    r.word = (vism !== null && vism < 500) ? '짙은 안개' : '안개';
  else if (rh >= 7)  r.word = '강한 비';
  else if (rh >= 2.5)r.word = '비';
  else if (rh >= 0.3)r.word = '약한 비';
  else if (c >= 51 && c <= 57) r.word = '이슬비';
  else r.word = '';
  return r;
}

/* ══════════ 13. 젖은 체감온도 ══════════ */
/**
 * 비를 맞으면 옷이 젖고 증발 냉각이 더해져 체감이 실제보다 훨씬 떨어진다.
 * 갯벌은 바람을 막아줄 것이 없어 이 효과가 그대로 온다.
 *   젖음도 w = 강수 강도로 포화되는 0~1 값
 *   추가 냉각 = w × (2.0 + 1.15×풍속)   [℃]
 * 물속에 들어가는 해루질은 하체가 이미 젖어 있어 기본 젖음도를 깔아준다.
 * @param feel 체감온도(℃)
 * @param wind 풍속(m/s)
 * @param rainH 강수량(mm/h)
 * @param wading 물속 작업 여부
 */
function wetChill_(feel, wind, rainH, wading){
  if (feel === null || feel === undefined) return null;
  var w = 1 - Math.exp(-(rainH || 0) / 1.6);          // 1.6mm/h면 약 절반 젖음
  if (wading) w = Math.max(w, 0.45);                   // 갯벌·물속은 기본 젖음
  var v = (wind === null || wind === undefined) ? 2 : wind;
  var drop = w * (2.0 + 1.15 * Math.min(v, 14));
  return feel - drop;
}

/**
 * 낚시에서 비의 두 얼굴.
 * 약한 비는 수면 파문으로 경계심을 낮추고 육상 먹이를 흘려보내 활성을 올린다.
 * 강한 비는 염분을 흐트러뜨리고 흙탕을 만들어 오히려 입질을 끊는다.
 * @return -1~+1 (활성 보정)
 */
function rainBite_(rainH, cloudPct){
  var r = rainH || 0;
  var b;
  if (r <= 3.0)       b = 0.55 * Math.sin(Math.PI * (r / 3.0));   // 1.5mm/h 부근에서 최고, r=0이면 0
  else if (r <= 8.0)  b = -0.7 * ((r - 3.0) / 5.0);   /* 3mm/h에서 0으로 연속 */
  else                b = -0.7;
  // 흐린 날은 광량이 낮아 경계심이 준다 (농어·감성돔·우럭)
  var cl = (cloudPct === null || cloudPct === undefined) ? 50 : cloudPct;
  b += 0.22 * Math.max(0, (cl - 55) / 45);
  return Math.max(-1, Math.min(1, b));
}

/* ══════════ 14. 섬 들어가는 길 ══════════ */
/**
 * 해루질의 핵심 시간은 간조 전후다. 그런데 섬은 배가 끊긴다.
 * 이 둘이 어긋나는지를 미리 알려주는 것이 이 함수의 목적이다.
 *
 * 연안여객선 운항대는 항로마다 다르므로 보수적인 공통값만 쓴다.
 * 실제 시간표는 예약처에서 확인하라고 안내한다 — 추정한 시각을 단정해서 보여주면
 * 그 시각에 맞춰 나갔다가 배를 놓친다.
 *
 * @param lowT  간조 시각 (시, 소수)
 * @param wave  파고(m)
 * @param wind  풍속(m/s)
 * @param carOk 차량 선적 가능 여부
 * @return {mode, word, risk, riskWord, needStay}
 */
var FERRY_FIRST = 7.5;      // 첫 배 통상 하한
var FERRY_LAST  = 17.5;     // 막배 통상 상한 (겨울은 더 이르다)

function ferryPlan_(lowT, wave, wind, carOk){
  var r = { mode:'', word:'', risk:0, riskWord:'', needStay:false };

  /* 1) 물때와 배 시간이 맞는가 */
  if (lowT === null || lowT === undefined){
    r.mode = 'unknown';
    r.word = '간조 시각을 먼저 확인하세요.';
  } else {
    var lt   = ((lowT % 24) + 24) % 24;
    var from = lt - 1.5, to = lt + 1.5;          // 작업 창
    var inOk  = from >= FERRY_FIRST + 1.0;        // 들어가서 자리 잡을 여유
    var outOk = to   <= FERRY_LAST  - 1.0;        // 나올 배를 탈 여유
    if (inOk && outOk){
      r.mode = 'day';
      r.word = '당일치기가 됩니다. 간조 ' + fmtH_(lt) + ' 전후로 작업하고 오후 배로 나오면 됩니다.';
    } else if (lt >= 19 || lt <= 5){
      r.mode = 'stay';
      r.needStay = true;
      r.word = '간조가 ' + fmtH_(lt) + '입니다. 해루질엔 좋은 시각이지만 그 시간엔 배가 없습니다 — 1박을 잡거나 다른 날을 고르세요.';
    } else {
      r.mode = 'tight';
      r.needStay = true;
      r.word = '간조 ' + fmtH_(lt) + '이라 당일 배로는 빠듯합니다. 첫 배·막배 시각을 확인하고 안 되면 1박 하세요.';
    }
  }

  /* 2) 뜰 수 있는 날인가 — 결항은 파고가 좌우한다 */
  if (wave !== null && wave !== undefined){
    if (wave >= 2.5)      { r.risk = 3; r.riskWord = '결항 가능성이 큽니다'; }
    else if (wave >= 1.5) { r.risk = 2; r.riskWord = '결항될 수 있습니다'; }
    else if (wave >= 1.0) { r.risk = 1; r.riskWord = '운항 여부를 꼭 확인하세요'; }
  }
  if (wind !== null && wind !== undefined && wind >= 14 && r.risk < 3){
    r.risk = 3; r.riskWord = '강풍 — 결항 가능성이 큽니다';
  }

  /* 3) 나가는 배가 끊기면 갇힌다 */
  if (r.risk >= 2 && !r.needStay){
    r.word += ' 들어갔다가 못 나올 수 있으니 돌아오는 배편까지 확인하세요.';
  }
  if (carOk === 0 || carOk === false){
    r.word += ' 차는 두고 들어가야 합니다.';
  }
  return r;
}
