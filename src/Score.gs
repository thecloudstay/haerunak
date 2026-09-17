/**
 * 해루낚 — 매력도 종합 분석
 *
 * Model.gs 의 물리·생태 모형을 실제로 계산해서 점수를 낸다.
 * 사용자는 숫자를 해석할 필요가 없다. 결론 문장과 시간창만 보면 된다.
 */

function clamp01_(v){ return v < 0 ? 0 : (v > 1 ? 1 : v); }
function lerpDown_(v, good, bad){
  if (v === null || v === undefined) return 0.6;
  return clamp01_((bad - v) / (bad - good));
}
function band_(v, lo, hi, soft){
  if (v === null || v === undefined) return 0.6;
  if (v >= lo && v <= hi) return 1;
  var d = v < lo ? (lo - v) : (v - hi);
  return clamp01_(1 - d/soft);
}
function fmtH_(h){
  h = ((h % 24) + 24) % 24;
  var m = Math.round(h % 1 * 60), hh = Math.floor(h);
  if (m === 60){ m = 0; hh = (hh + 1) % 24; }
  return ('0'+hh).slice(-2) + ':' + ('0'+m).slice(-2);
}
function fmtRange_(a, b){ return fmtH_(a) + '~' + fmtH_(b); }

var FLOOR_KO = { mud:'펄갯벌', mix:'혼합갯벌', sand:'모래갯벌', rock:'갯바위·돌밭', none:'갯벌 없음' };
var FLOOR_K  = { mud:1.00, mix:1.00, sand:0.92, rock:0.80, none:0.22 };

/** 야간 해루질 기준 간조 하나를 고른다 */
function pickNightLow_(events, sunset){
  var lows = events.filter(function(e){ return e.k === 'L'; });
  if (!lows.length) return null;
  var best = null, bestScore = -1;
  lows.forEach(function(e){
    var t = e.t, sc, after = t - sunset;
    if (after >= -1 && after <= 5) sc = 100 - Math.abs(after - 2) * 6;
    else if (t >= 0 && t < 4.5)    sc = 74 - t * 3;
    else if (t > sunset + 5)       sc = 60;
    else                           sc = 25 - Math.abs(t - 13) * 1.2;
    if (sc > bestScore){ bestScore = sc; best = e; }
  });
  return { ev: best, timing: clamp01_(bestScore/100) };
}

/** 조석 이벤트 ±2시간과 박명 기준 피딩타임의 겹침 */
function feedOverlap_(events, dawn, dusk, sunrise, sunset){
  var win = [];
  if (dawn !== null && sunrise !== null) win.push([dawn, sunrise + 1.2]);
  if (sunset !== null && dusk !== null)  win.push([sunset - 1.2, dusk]);
  var best = { ov: 0, from: null, to: null, ev: null };
  events.forEach(function(e){
    var a = e.t - 2, b = e.t + 2;
    win.forEach(function(w){
      var lo = Math.max(a, w[0]), hi = Math.min(b, w[1]);
      if (hi - lo > best.ov) best = { ov: hi - lo, from: lo, to: hi, ev: e };
    });
  });
  if (!best.ev && events.length){
    var e0 = events[0];
    events.forEach(function(e){ if (Math.abs(e.t - 17) < Math.abs(e0.t - 17)) e0 = e; });
    best = { ov: 0, from: e0.t - 1.5, to: e0.t + 1.5, ev: e0 };
  }
  return best;
}

/** 시간창 안에서 조류 유속이 낚시에 알맞은 정도 */
/* ══════════════ 어종별 선호 물때 단계 ══════════════
 * 실전에서 어종마다 잘 되는 물때가 다르다. 특히 서해 강화 숭어는 물이 차오르는
 * 들물~만조에 훌치기가 되고 간조(물 다 빠진 정조)에는 사실상 안 된다.
 * 단계: 'flood'=들물(밀물), 'ebb'=날물(썰물), 'high'=만조 부근, 'low'=간조 부근,
 *       'move'=물 움직일 때(들·날물 공통, 정조 싫음), 'any'=무관.
 * 근거 확인된 것만 넣고, 나머지는 손대지 않는다(any). */
var FISH_TIDE = {
  /* 확실한 물때 의존(조사·통설 확인) */
  '숭어':'flood',      // 들물~만조 훌치기·찌, 간조엔 안 됨(강화 서해 대표)
  '망둥어':'flood',    // 밀물에 갯벌 안쪽 수로로 들어온다
  '문절망둑':'flood',
  '보리멸':'flood',    // 서해에서 들물에 입질 왕성
  '밴댕이':'flood',    // 서해 갯벌 회유어, 들물에 연안 접근
  '붕장어':'ebb', '갯장어':'ebb',   // 야행성, 물 빠질 때 사냥
  /* 물 흐를 때(정조 싫음) — 회유·활성 어종 */
  '농어':'move', '감성돔':'move', '참돔':'move', '돌돔':'move', '벵에돔':'move',
  '방어':'move', '부시리':'move', '무늬오징어':'move',
  '고등어':'move', '전갱이':'move', '삼치':'move', '갈치':'move',
  '백조기':'move', '가자미':'move', '도다리':'move', '대구':'move',
  /* 물때 방향 영향 적음(조차 크기·시간대가 더 중요) */
  '우럭':'any', '광어':'any', '놀래미':'any', '쥐노래미':'any',
  '볼락':'any', '열기':'any', '갑오징어':'any', '주꾸미':'any', '한치':'any', '학공치':'any'
};
/* 해루질 채집물 — 대부분 「물 빠질 때(날물~간조)」 드러난 갯벌·바위에서 줍는다.
 * 낙지·문어 등 야행성 구멍 사냥도 물 빠진 갯벌이 기본. */
var HAERU_TIDE = {
  '낙지':'low', '문어':'low', '주꾸미':'low', '박하지':'low', '꽃게':'low',
  '갯가재':'low', '쏙':'low', '칠게':'low', '짱뚱어':'low',
  '바지락':'low', '동죽':'low', '백합':'low', '가무락':'low', '모시조개':'low',
  '맛조개':'low', '개조개':'low', '가리맛조개':'low', '참꼬막':'low', '피조개':'low',
  '명주조개':'low', '골뱅이':'low', '개불':'low',
  '소라':'low', '뿔소라':'low', '피뿔고둥':'low', '고둥':'low', '갯고둥':'low',
  '보말':'low', '배말':'low', '따개비':'low', '거북손':'low', '군소':'low',
  '굴':'low', '홍합':'low', '해삼':'low', '오분자기':'low', '성게':'low',
  '돌멍게':'low', '미역':'low', '톳':'low', '청각':'low', '파래':'low', '갯고둥':'low'
};

/* ══════════════ 조간대 높이 — 물때가 대상을 바꾼다 ══════════════
 * 갯벌은 높이에 따라 사는 것이 다르다. 물가에서 먼 위쪽은 조금에도 드러나지만,
 * 아래쪽은 사리에 크게 빠져야 비로소 나온다. 그래서 같은 자리라도 물때에 따라
 * 「오늘 뭘 잡을 수 있느냐」가 통째로 바뀐다. 조차 7~9미터인 서해에서 특히 그렇다.
 *
 *   'up'  위쪽  — 조금에도 드러난다. 바위에 붙어 사는 것들
 *   'mid' 가운데 — 보통 물때면 된다. 캐는 조개 대부분
 *   'low' 아래쪽 — 사리라야 드러난다. 물가 끝에서 잡는 것들
 *
 * 근거 강도는 「중간」이다. 조간대 대상 분포는 갯벌 생태의 기본이고 현장에서도
 * 그대로 통하지만, 종마다 높이를 못 박은 문헌을 다 찾지는 못했다.
 * 그래서 점수를 잠그지 않고 가감만 한다 — 틀려도 순서가 조금 바뀔 뿐이다. */
var FLAT_ZONE = {
  /* 위쪽 — 바위·돌에 붙어 산다. 조금에도 손이 닿는다 */
  '굴':'up', '홍합':'up', '따개비':'up', '거북손':'up', '배말':'up',
  '고둥':'up', '갯고둥':'up', '보말':'up', '비단고둥':'up', '군소':'up', '톳':'up',
  /* 가운데 — 캐는 조개. 보통 물때면 된다 */
  '바지락':'mid', '동죽':'mid', '백합':'mid', '가무락':'mid', '모시조개':'mid',
  '꼬막':'mid', '맛조개':'mid', '명주조개':'mid', '떡조개':'mid', '서해비단조개':'mid',
  '칠게':'mid', '짱뚱어':'mid', '갯지렁이':'mid',
  /* 아래쪽 — 사리에 크게 빠져야 나온다. 해루질의 진짜 재미가 여기 있다 */
  '낙지':'low', '문어':'low', '주꾸미':'low', '박하지':'low', '돌게':'low', '꽃게':'low',
  '소라':'low', '뿔소라':'low', '피뿔고둥':'low', '골뱅이':'low',
  '해삼':'low', '전복':'low', '오분자기':'low', '성게':'low', '돌멍게':'low',
  '개조개':'low', '키조개':'low', '가리맛조개':'low', '대맛':'low', '홍맛':'low',
  '개불':'low', '대하':'low', '미역':'low'
};
/* 오늘 물때에 그 대상이 드러나는가. 0.2(안 나옴)~1(잘 나옴)
   expo 0 = 조금, 1 = 사리 */
function zoneFit_(zone, expo){
  if (zone === 'up')  return 1;                      // 위쪽은 언제나 손이 닿는다
  if (zone === 'low') return 0.28 + 0.72 * expo;     // 사리라야 나온다
  return 0.62 + 0.38 * expo;                         // 가운데
}

/* ══════════════ 사리냐 조금이냐 — 낚시 ══════════════
 * 물살이 세야 되는 대상과, 세면 채비가 안 서는 대상이 갈린다.
 * 근거를 실제로 확인한 것만 넣었다. 나머지는 손대지 않는다.
 *   1 사리가 낫다 · 0 상관없다 · -1 조금이 낫다 · 0.5 중간물때가 낫다(양끝 다 싫다)
 * 광어·주꾸미는 걸어 들어가면 사리, 배로 나가면 조금이라 자료가 정반대다 — 건드리지 않았다. */
var FISH_SPRING = {
  '농어':1,                                  // 들물~만조 물돌이에 활성, 물이 흘러야 붙는다
  '참돔':-1, '우럭':-1, '갑오징어':-1, '문어':-1,   // 물살 세면 채비가 안 선다(서해 선상은 조금 전후 출조)
  '돌돔':0.5, '갈치':0.5                      // 사리는 너무 빠르고 조금은 너무 약하다
};
function springFit_(pref, expo){
  if (pref === undefined || pref === null) return 1;
  if (pref === 1)    return 0.45 + 0.55 * expo;
  if (pref === -1)   return 0.45 + 0.55 * (1 - expo);
  if (pref === 0.5)  return 1 - 0.45 * Math.abs(expo - 0.5) * 2;
  return 1;
}

/* 그 시각의 물때 단계를 잰다.
 * 반환 {rising:들물여부, level01:0(간조)~1(만조), slack:정조(0.15미만 움직임)} */
function tideStageAt_(tide, hour){
  var ev = (tide.events || []).slice().sort(function(a,b){ return a.t - b.t; });
  if (ev.length < 2) return { rising:true, level:0.5, slack:false };
  var prev = null, next = null;
  for (var k = 0; k < ev.length - 1; k++){
    if (hour >= ev[k].t && hour <= ev[k+1].t){ prev = ev[k]; next = ev[k+1]; break; }
  }
  if (!prev){
    if (hour < ev[0].t){ next = ev[0]; prev = { t: ev[0].t - 6.21, k:(ev[0].k==='H'?'L':'H') }; }
    else { prev = ev[ev.length-1]; next = { t: prev.t + 6.21, k:(prev.k==='H'?'L':'H') }; }
  }
  var span = next.t - prev.t; if (span <= 0) return { rising:true, level:0.5, slack:false };
  var ph = (hour - prev.t)/span;                       // 0~1
  var rising = (next.k === 'H');                       // 다음이 만조면 들물
  // 코사인 보간 — 정조(만조·간조 순간)에서 완만
  var lvl = rising ? (0.5 - 0.5*Math.cos(Math.PI*ph)) : (0.5 + 0.5*Math.cos(Math.PI*ph));
  var slack = (ph < 0.12 || ph > 0.88);                // 만·간조 직전후 = 정조
  return { rising:rising, level:lvl, slack:slack };
}
/* 어종이 원하는 물때인지 0(안 맞음)~1(딱 맞음) */
function tideStageFit_(pref, st){
  if (!pref || pref === 'any') return 1;
  var L = st.level, up = st.rising, slack = st.slack;
  switch(pref){
    case 'flood': return up ? (0.35 + 0.65*L) : Math.max(0.12, 0.5 - 0.4*L);   // 들물·물 높을수록↑, 날물·간조↓
    case 'ebb':   return !up ? (0.35 + 0.65*(1-L)) : Math.max(0.12, 0.5 - 0.4*(1-L));
    case 'high':  return Math.max(0.15, L);                                     // 만조 부근
    case 'low':   return Math.max(0.15, 1 - L);                                 // 간조 부근(갯벌 드러남)
    case 'move':  return slack ? 0.3 : (0.55 + 0.45*Math.abs(L-0.5)*2*0);       // 정조만 싫다
    default: return 1;
  }
}

/* 대상어가 좋아하는 물때에 맞춰 시간창 후보를 만든다.
   창을 먼저 정해 놓고 「어종이 물때에 안 맞는다」고 깎던 것을 뒤집는 부분이다.
   숭어 훌치기는 물이 차오르는 동안이 자리다 — 만조를 지나면 그날은 끝난다. */
function prefWindows_(events, pref){
  var out = [];
  var ev = (events || []).slice().sort(function(a, b){ return a.t - b.t; });
  for (var i = 0; i < ev.length; i++){
    var e = ev[i], nx = ev[i+1];
    if (pref === 'flood' && e.k === 'H')      out.push([e.t - 2.8, e.t - 0.2]);   // 만조 앞 들물
    else if (pref === 'ebb' && e.k === 'H')   out.push([e.t + 0.4, e.t + 3.0]);   // 만조 뒤 날물
    else if (pref === 'high' && e.k === 'H')  out.push([e.t - 1.5, e.t + 1.5]);
    else if (pref === 'low'  && e.k === 'L')  out.push([e.t - 1.5, e.t + 1.5]);
    else if (pref === 'move' && nx){ var m = (e.t + nx.t) / 2; out.push([m - 1.4, m + 1.4]); }
  }
  return out.filter(function(w){ return w[1] > 0.5 && w[0] < 23.5; })
            .map(function(w){ return [Math.max(0, w[0]), Math.min(24, w[1])]; });
}
/* 후보 창 가운데 여명·황혼 피딩타임과 가장 잘 겹치는 것을 고른다.
   겹치는 게 없으면 해 떠 있는 시간에 가까운 창을 고른다 — 밤새 서 있으라 할 수는 없다. */
function pickWindow_(cands, dawn, dusk, sunrise, sunset){
  if (!cands || !cands.length) return null;
  var feed = [];
  if (dawn !== null && sunrise !== null) feed.push([dawn, sunrise + 1.2]);
  if (sunset !== null && dusk !== null)  feed.push([sunset - 1.2, dusk]);
  var best = null, bs = -1;
  cands.forEach(function(w){
    var ov = 0;
    feed.forEach(function(f){ ov = Math.max(ov, Math.min(w[1], f[1]) - Math.max(w[0], f[0])); });
    ov = Math.max(0, ov);
    var mid = (w[0] + w[1]) / 2;
    var day = (sunrise !== null && sunset !== null && mid > sunrise - 1 && mid < sunset + 1.5) ? 0.6 : 0;
    var sc = ov + day;
    if (sc > bs){ bs = sc; best = { from: w[0], to: w[1], ov: ov }; }
  });
  return best;
}

function flowFit_(p, tide, from, to){
  var best = 0, sum = 0, n = 0;
  for (var t = from; t <= to; t += 0.25){
    var kn = toKnot_(currentAt_(p, tide, ((t % 24) + 24) % 24));
    var f = band_(kn, 0.35, 1.4, 1.1);       // 0.35~1.4노트가 알맞다
    sum += f; n++;
    if (kn > best) best = kn;
  }
  return { fit: n ? sum/n : 0.6, peak: best };
}

/* ══════════════ 핵심 채점기 ══════════════ */
function analyze_(p, ds, tide, wxRec, want){
  var a = ds.split('-'), y = +a[0], mo = +a[1], d = +a[2];
  var sun  = sunTimes_(y, mo, d, p.la, p.lo);
  var tw   = sunAtAlt_(y, mo, d, p.la, p.lo, -6);        // 시민박명
  var age  = moonAge_(y, mo, d);
  var mul  = tide.mul ? { name: tide.mul } : multtae_(age, p.s);
  var ev   = tide.events || [];
  var range = tide.range || 0;
  var relRange = p.mr > 0.05 ? clamp01_(range / (p.mr * 1.48)) : 0;
  var floorK = FLOOR_K[p.f] || 0.7;
  var day = wxDay_(wxRec);

  /* ── 해루질 ─────────────────────────────── */
  var nl   = pickNightLow_(ev, sun.set);
  var lowT = nl ? nl.ev.t : null;
  var hWx  = wxAt_(wxRec, lowT === null ? 21 : lowT);
  var hCur = lowT === null ? 0 : currentAt_(p, tide, lowT);

  // 갯벌 노출 — 조위 낙차와 경사로 실제 드러나는 폭을 낸다
  var msl   = p.mr * 100 * 0.78;
  var lowLv = nl ? nl.ev.lv : msl;
  var width = flatWidth_(msl, lowLv, p.f);
  var wIdx  = clamp01_(Math.log(1 + width/120) / Math.log(1 + 2500/120));
  var expo  = clamp01_((relRange - 0.42) / 0.58);
  var sExpoBase = (0.42*wIdx + 0.34*expo + 0.24*clamp01_(range/3.2)) * floorK;

  // 수중 시야 — 파랑이 바닥을 흔들고, 조류·강우가 흙을 실어 나른다
  var vis = underwaterVis_({
    wave: hWx.wave, period: hWx.wper, floor: p.f, sea: p.s,
    current: Math.abs(hCur), rain24: day.rainSum, month: mo
  });
  /* 시야가 해루질의 성패를 가른다 — 배점에서 가장 큰 자리를 준다.
     다만 절대 미터로 재면 서해는 영원히 꼴찌가 된다. 서해 물은 원래 탁하고,
     서해 사람에게 「제주가 맑다」는 말은 쓸모가 없다. 그래서 그 해역에서
     기대할 수 있는 폭 안에서 오늘이 어느 자리인지로 잰다. */
  /* 띠는 해역만이 아니라 바닥질·달까지 본다 — 같은 서해라도 펄과 갯바위는 다른 물이다.
     띠 계산과 오늘값 계산이 같은 식을 쓰므로, q 는 순수하게 「오늘 날씨가 물색을
     얼마나 흐렸나」만 남는다. 서해치고 맑은 날이 실제로 위로 올라온다. */
  var vb2 = visBandFor_(p.f, p.s, mo);
  var visQ = clamp01_((Math.log(vis.vis) - Math.log(vb2.lo)) / (Math.log(vb2.hi) - Math.log(vb2.lo)));
  vis.q = visQ;   // 결론 문장이 그 바다 기준으로 말하게
  var visWord = visQ >= 0.80 ? '최상' : visQ >= 0.60 ? '맑음' : visQ >= 0.38 ? '보통'
              : visQ >= 0.18 ? '탁함' : '거의 안 보임';
  /* 시야가 중요한 정도는 바닥질에 따라 다르다.
     갯바위에서 문어·소라를 눈으로 찾는 일은 시야가 전부지만,
     갯벌에서 조개를 파는 일은 물이 빠진 뒤라 시야가 거의 상관없다.
     시야에 안 쓴 배점은 「얼마나 드러나느냐」로 넘긴다 — 그쪽이 성패를 가르기 때문이다. */
  var VIS_W = { rock:1.0, mix:0.75, sand:0.45, mud:0.30, none:0.6 };
  var vw = VIS_W[p.f] !== undefined ? VIS_W[p.f] : 0.7;
  var sVis = 32 * vw * visQ;

  var sTime = 18 * (nl ? nl.timing : 0.3);

  var hWe = windEffect_(p, hWx.wind, hWx.wdir);
  // 작업 시간대의 실제 하늘 — 하루 총량이 아니라 그 시각 값을 본다
  var hSky  = skyRisk_(hWx.code, hWx.vism, hWx.rain, hWx.snow);
  var hChil = wetChill_(hWx.feel, hWx.wind, hWx.rain, true);   // 갯벌은 젖은 채로 선다
  var sSafe = 16 * (0.30*lerpDown_(hWe.eff, 4, 13)
                  + 0.25*lerpDown_(hWx.wave, 0.25, 1.1)
                  + 0.22*band_(hChil === null ? hWx.feel : hChil, 8, 30, 12)
                  + 0.13*lerpDown_(Math.abs(toKnot_(hCur)), 0.6, 2.4)
                  + 0.10*lerpDown_(hSky.level, 2, 9));

  // 대상 활성 — 수온 적정 + 제철 + 야행성 보정
  var hAll = speciesOf_(p, 'haeru');
  var hSeason = rankTargets_(inSeason_(hAll, mo, SEASON_SP), p, mo, 'haeru');
  var hTherm = 0;
  hSeason.forEach(function(t){ var v = thermalFit_(t.n, hWx.sst); if (v > hTherm) hTherm = v; });
  // 실제 조황(잡힌 사례) — 이 해역·이맘때 실제 채집 보고 강도로 모델을 보정
  var hZone = zoneOf_(p), hCatchV = null, hCatchName = null;
  hSeason.forEach(function(t){ var cv = catchAt_(t.n, hZone, mo); if (cv !== null && (hCatchV === null || cv > hCatchV)){ hCatchV = cv; hCatchName = t.n; } });
  var hCatchN = (hCatchV === null) ? 0.5 : hCatchV/2;   // 0비시즌·0.5시즌/무자료·1성수기
  var lux = moonLux_(y, mo, d, lowT === null ? 21 : lowT, p.la, p.lo, age);
  // 구름이 달을 가리면 실제 노출 조도는 크게 떨어진다 (야행성 대상에 유리)
  if (hWx.cloud !== null && hWx.cloud !== undefined) lux *= (1 - 0.78 * Math.min(1, hWx.cloud/100));
  var nocturn = clamp01_(1 - Math.min(1, lux/0.22)*0.45) ;   // 어두울수록 문어·낙지 유리
  var sLive = 8 * (0.5*hTherm + 0.28*clamp01_((hSeason.length ? hSeason[0].v : 1)/3) + 0.22*nocturn);
  sLive *= (0.92 + 0.16*hCatchN);   // 실제 조황 보정: 성수기 +8%, 비시즌 -8%, 무자료 중립

  /* 오늘 물때에 실제로 드러나는 대상이 있는가.
     조금인데 제철 대상이 죄다 물가 끝(낙지·문어·소라)이면 가 봐야 헛걸음이다.
     반대로 굴·고둥처럼 위쪽에 붙은 것이 대상이면 조금이라도 상관없다.
     조차가 작은 바다(동해)에는 이 잣대를 대지 않는다 — 거기선 물때가 대상을 안 바꾼다. */
  var zoneOn = (p.mr >= 1.5);
  var hZoneFit = 1, hZoneBest = null, hZoneLow = [];
  if (zoneOn && hSeason.length){
    var zSum = 0, zW = 0;
    hSeason.forEach(function(t, k){
      var z = FLAT_ZONE[t.n]; if (!z) return;
      var f = zoneFit_(z, expo), w = 1 / (1 + k*0.6);   // 제철 1순위에 무게를 더 준다
      zSum += f*w; zW += w;
      if (!hZoneBest || f > hZoneBest.f) hZoneBest = { n:t.n, z:z, f:f };
      if (z === 'low' && f < 0.55) hZoneLow.push(t.n);
    });
    if (zW > 0) hZoneFit = zSum / zW;
  }
  // 시야에서 남은 배점을 노출로 옮긴다 — 총점은 100 그대로다
  var sExpo = (26 + 32*(1 - vw)) * sExpoBase;
  var hRaw = sExpo + sVis + sTime + sSafe + sLive;
  /* 최대 22%까지만 가감한다. 근거 강도가 중간이라 순서만 바꾸고 판을 뒤집진 않는다. */
  hRaw = hRaw * (0.78 + 0.22 * hZoneFit);

  // 안전 게이트
  var hCap = 100;
  if (hWx.wave !== null){
    if (hWx.wave >= 1.5) hCap = Math.min(hCap, 26);
    else if (hWx.wave >= 1.1) hCap = Math.min(hCap, 44);
    else if (hWx.wave >= 0.8) hCap = Math.min(hCap, 60);
  }
  if (hWx.wind !== null){
    if (hWe.eff >= 12) hCap = Math.min(hCap, 28);
    else if (hWe.eff >= 9) hCap = Math.min(hCap, 50);
  }
  if (Math.abs(toKnot_(hCur)) >= 2.2) hCap = Math.min(hCap, 38);
  if (day.rainSum !== null && day.rainSum >= 20) hCap = Math.min(hCap, 40);
  if (hWx.rain !== null && hWx.rain >= 4) hCap = Math.min(hCap, 34);     // 작업 시간에 쏟아짐
  // 뇌우 — 갯벌 한가운데서는 사람이 가장 높은 물체다. 점수가 아니라 금지에 가깝다
  if (hSky.storm) hCap = Math.min(hCap, 8);
  // 안개 — 갯벌 고립 사고의 첫째 원인은 방향 상실이다
  if (hSky.fog) hCap = Math.min(hCap, hWx.vism !== null && hWx.vism < 500 ? 18 : 32);
  if (hSky.freeze) hCap = Math.min(hCap, 20);
  if (hSky.snow) hCap = Math.min(hCap, 38);
  if (hChil !== null && hChil <= 0) hCap = Math.min(hCap, 26);           // 젖은 채 저체온
  if (hWx.feel !== null && hWx.feel <= 2) hCap = Math.min(hCap, 42);
  /* 시야 게이트는 「물속에 들어가 눈으로 찾는」 방식에만 건다.
     물 빠진 갯벌에서 조개를 파는 데는 시야가 상관없고,
     서해 물은 원래 탁해서 여기에 절대 기준을 걸면 서해가 통째로 막힌다.
     그래서 그 해역에서 기대할 수 있는 폭의 아래쪽에 걸렸을 때만 잠근다. */
  /* 2026-09 고침 — 바닥질만 보고 잠그니 서해 혼합갯벌이 통째로 45점에 묶였다.
     제부도·석모도 같은 곳은 사리든 조금이든 늘 45점이라 물때가 아무 뜻이 없었다.
     실제로 그 자리 사람들은 물속을 들여다보는 게 아니라 물 빠진 갯벌에서 조개를 캔다.
     그러니 잣대를 바닥질이 아니라 「오늘 무엇을 노리느냐」에 건다 —
     눈으로 찾아야 하는 대상(문어·소라·꽃게류)이 오늘의 주 대상일 때만 잠근다. */
  var sightMain = hSeason.length
    ? hSeason.slice(0,2).every(function(t){ return SIGHT_HUNT[t.n] || FLAT_ZONE[t.n] === 'low' && !DIG_[t.n]; })
    : (p.f === 'rock');
  if ((p.f === 'rock' || p.f === 'mix') && sightMain && vis.vis < 0.30 && visQ < 0.35)
    hCap = Math.min(hCap, 45);
  if (p.f === 'none') hCap = Math.min(hCap, 28);
  var hScore = Math.round(Math.min(hRaw, hCap));

  var hWhy = [], hWarn = [];
  if (wIdx > 0.7) hWhy.push('갯벌이 ' + (width >= 1000 ? (width/1000).toFixed(1) + 'km' : Math.round(width/10)*10 + 'm') + ' 가량 드러남');
  if (expo > 0.72) hWhy.push('사리 물때 (' + mul.name + ')');
  else if (expo < 0.3) hWarn.push('조금 물때 — 얕게만 빠짐');
  /* 물때가 대상을 바꾼다 — 오늘 뭐가 드러나고 뭐가 안 드러나는지 그대로 말해 준다 */
  if (zoneOn && hZoneLow.length)
    hWarn.push(hZoneLow.slice(0,3).join('·') + '은(는) 물가 끝이라 이 물때엔 잘 안 드러납니다'
               + (hZoneBest && hZoneBest.f > 0.8 ? ' — 대신 ' + hZoneBest.n + '은 됩니다' : ''));
  else if (zoneOn && hZoneFit > 0.85 && hZoneBest && hZoneBest.z === 'low')
    hWhy.push('물가 끝까지 드러나는 물때 — ' + hZoneBest.n + ' 노릴 수 있음');
  if (nl && nl.timing > 0.8) hWhy.push('간조가 밤 시간대에 딱 걸림');
  if (hCatchV >= 2 && hCatchName) hWhy.push('실제 조황 — 이맘때 이 지역 ' + hCatchName + ' 채집 보고 많음');
  else if (nl && nl.timing < 0.45) hWarn.push('간조가 낮이라 야간 작업 창이 짧음');
  var visTxt = (vis.vis >= 1 ? vis.vis.toFixed(1)+'m' : Math.round(vis.vis*100)+'cm');
  if (visQ >= 0.60) hWhy.push('수중 시야 ' + visTxt + ' — 이 바다 기준 ' + visWord);
  else if (visQ < 0.18) hWarn.push('수중 시야 ' + visTxt + ' — 이 바다 기준으로도 ' + visWord);
  if (vis.R > 1.4) hWarn.push('파랑이 바닥을 흔들어 흙탕물');
  if (lux < 0.02) hWhy.push('달 없는 밤 — 문어·낙지 활동 좋음');
  else if (lux > 0.18) hWarn.push('달이 밝아 야행성 대상이 숨음');
  // 낮 물때에 야행성 대상을 노리고 나가면 헛걸음이다 — 분명히 적는다
  if (daylightAt_(lowT, sun) >= 1)
    hWarn.push('간조가 대낮 — 낙지·문어·주꾸미·꽃게는 이 시각엔 숨어 있습니다');
  if (visQ < 0.18 && hSeason.some(function(t){ return SIGHT_HUNT[t.n]; }))
    hWarn.push('물이 흐려 랜턴 사냥(꽃게·문어류)은 어렵습니다 — 호미로 파는 대상 위주로 가세요');
  if (Math.abs(toKnot_(hCur)) >= 1.6) hWarn.push('조류 ' + Math.abs(toKnot_(hCur)).toFixed(1) + '노트 — 발 밑 조심');
  if (hWx.wind !== null && hWe.eff >= 9) hWarn.push((hWe.wo.word||'바람') + ' ' + Math.round(hWx.wind) + 'm/s — 체온 손실·물결 주의');
  if (p.f === 'none') hWarn.push('조차가 작아 갯벌 노출이 거의 없음');
  // 하늘 — 작업 시간대 기준
  if (hSky.storm) hWarn.unshift('뇌우 예보 — 갯벌에서는 사람이 가장 높은 물체입니다. 나가지 마세요');
  else if (hSky.fog) hWarn.unshift('안개' + (hWx.vism !== null ? ' (시정 ' + Math.round(hWx.vism) + 'm)' : '')
                                   + ' — 갯벌에서 방향을 잃으면 고립됩니다');
  else if (hSky.freeze) hWarn.unshift('얼어붙는 비 — 갯바위·경사로 결빙');
  else if (hSky.snow) hWarn.push('눈 — 발판이 미끄럽고 갯벌 경계가 안 보임');
  else if (hWx.rain !== null && hWx.rain >= 4) hWarn.push('작업 시간에 시간당 ' + hWx.rain.toFixed(1) + 'mm 비 — 젖고 흙탕물 짐');
  else if (hWx.rain !== null && hWx.rain >= 0.3) hWarn.push(hSky.word + ' 예보 — 여벌 옷과 방수 준비');
  if (hChil !== null && hWx.feel !== null && hChil <= hWx.feel - 3){
    hWarn.push('젖으면 체감 ' + Math.round(hChil) + '도까지 떨어짐 (기상 체감 ' + Math.round(hWx.feel) + '도)');
  }
  if (day.rainSum !== null && day.rainSum >= 10 && (hWx.rain === null || hWx.rain < 1)){
    hWarn.push('낮에 ' + Math.round(day.rainSum) + 'mm 내려 흙탕물 유입 — 시야는 기대 이하');
  }
  // 안전 경고는 반드시 '왜'를 달고 나간다 — 이유 없는 경고는 무시당한다
  if (hCap <= 45){
    var hRsn = hSky.storm ? '뇌우'
             : hSky.fog ? '안개'
             : hSky.freeze ? '결빙'
             : (hWx.wave !== null && hWx.wave >= 0.8) ? '파고 ' + hWx.wave.toFixed(1) + 'm'
             : (hWx.wind !== null && hWe.eff >= 9) ? '바람 ' + Math.round(hWe.eff) + 'm/s'
             : (Math.abs(toKnot_(hCur)) >= 2.2) ? '조류 ' + Math.abs(toKnot_(hCur)).toFixed(1) + '노트'
             : (hChil !== null && hChil <= 0) ? '저체온'
             : (day.rainSum !== null && day.rainSum >= 20) ? '비 ' + Math.round(day.rainSum) + 'mm'
             : hSky.snow ? '눈'
             : ((p.f === 'rock' || p.f === 'mix') && vis.vis < 0.30 && visQ < 0.35) ? '시야 없음' : '';
    hWarn.unshift('안전 경고' + (hRsn ? ' (' + hRsn + ')' : '') + ' — 오늘 이 지점 입수는 권하지 않습니다');
  }

  /* ── 낚시 ───────────────────────────────── */
  var fAll0    = speciesOf_(p, 'fish');
  var fSeason0 = rankTargets_(inSeason_(fAll0, mo, SEASON_FX), p, mo, 'fish');
  var fPref0   = fSeason0.length ? FISH_TIDE[fSeason0[0].n] : null;
  var fo   = feedOverlap_(ev, tw.rise, tw.set, sun.rise, sun.set);
  /* 제철 1순위 어종이 특정 물때에만 되는 고기라면(숭어 들물처럼) 그 물때로 창을 옮긴다.
     그래야 「비추천」이 아니라 「몇 시에 가면 된다」가 나온다. */
  if (fPref0 && fPref0 !== 'any'){
    var pw = pickWindow_(prefWindows_(ev, fPref0), tw.rise, tw.set, sun.rise, sun.set);
    if (pw) fo = { ov: pw.ov, from: pw.from, to: pw.to, ev: fo.ev, pref: 1 };
  }
  var fMid = (fo.from + fo.to)/2;
  var fWx  = wxAt_(wxRec, ((fMid % 24) + 24) % 24);
  var sol  = solunar_(y, mo, d, p.la, p.lo, age);
  var solV = solunarAt_(sol, ((fMid % 24) + 24) % 24);
  var flow = flowFit_(p, tide, fo.from, fo.to);
  var visF = underwaterVis_({ wave: fWx.wave, period: fWx.wper, floor: p.f, sea: p.s,
                              current: flow.peak/1.94, rain24: day.rainSum, month: mo, depth: 3 });

  var fSky  = skyRisk_(fWx.code, fWx.vism, fWx.rain, fWx.snow);
  var fBite = rainBite_(fWx.rain, fWx.cloud);   // 약한 비·흐림은 오히려 가점
  var sFeed = 28 * clamp01_(0.30 + (fo.ov > 0 ? fo.ov/3.2*0.40 : 0) + solV*0.30 + fBite*0.16);
  /* 대상어 물때에 맞춰 창을 옮긴 경우, 그 창이 여명·황혼을 비켜 갔다고 두 번 깎지 않는다.
     숭어 훌치기는 한낮 들물에도 되는 낚시다 — 피딩타임만으로 재면 그런 자리를 놓친다. */
  if (fo.pref) sFeed = Math.max(sFeed, 28 * 0.46);
  var sFlow = 18 * (p.mr > 0.4 ? (0.6*flow.fit + 0.4*band_(relRange, 0.5, 0.92, 0.42)) : 0.68);
  // 바람은 방향까지 본다 — 등바람은 체감을 깎고, 알맞은 맞바람은 활성 가점
  var we = windEffect_(p, fWx.wind, fWx.wdir);
  var fChil = wetChill_(fWx.feel, fWx.wind, fWx.rain, false);   // 낚시는 물에 안 들어간다
  var sSea  = 20 * (0.48*lerpDown_(fWx.wave, 0.25, 1.8)
                  + 0.28*lerpDown_(we.eff, 3.5, 13)
                  + 0.10*we.bonus
                  + 0.14*band_(fChil === null ? fWx.feel : fChil, 4, 30, 10));

  var fAll = fAll0;
  var fSeason = fSeason0;
  var fTherm = 0, fBestName = null;
  fSeason.forEach(function(t){
    var v = thermalFit_(t.n, fWx.sst) * (0.6 + t.v*0.1333);
    if (v > fTherm){ fTherm = v; fBestName = t.n; }
  });
  // 실제 조황(잡힌 사례) 보정
  var fZone = zoneOf_(p), fCatchV = null, fCatchName = null;
  fSeason.forEach(function(t){ var cv = catchAt_(t.n, fZone, mo); if (cv !== null && (fCatchV === null || cv > fCatchV)){ fCatchV = cv; fCatchName = t.n; } });
  var fCatchN = (fCatchV === null) ? 0.5 : fCatchV/2;
  var sSst = 16 * clamp01_(fTherm) * (0.92 + 0.16*fCatchN);

  var dp = pressTrend_(wxRec ? wxRec.pres : null, fMid);
  var sPres = 8 * pressScore_(dp);
  // 물색 — 맑을수록 좋다 (0.3m에서 0점, 6m 이상이면 만점)
  /* 물색도 그 바다 기준으로 잰다. 절대값으로 재면 서해 낚시는 어디서든 0점이고
     동해는 어디서든 만점이라 지점을 가르는 힘이 없다. 그리고 낚시는 「맑을수록 좋다」가
     아니다 — 유리처럼 맑으면 경계심이 올라간다. 약간 흐린 쪽에 정점을 둔다. */
  var fvb = visBandFor_(p.f, p.s, mo);
  var fq  = clamp01_((Math.log(Math.max(0.03, visF.vis)) - Math.log(fvb.lo)) / (Math.log(fvb.hi) - Math.log(fvb.lo)));
  var sTurb = 10 * (fq < 0.55 ? clamp01_(fq / 0.55) : (1 - 0.2 * clamp01_((fq - 0.85) / 0.15)));

  /* ── 대상어 물때 적합성 — 숭어처럼 특정 물때에만 되는 어종을 걸러낸다 ── */
  var fStage = tideStageAt_(tide, ((fMid % 24) + 24) % 24);
  var fTideFit = 1, fTideWorst = null, fTideWorstV = 2;
  fSeason.forEach(function(t){
    var pf = FISH_TIDE[t.n];
    if (!pf) return;
    var v = tideStageFit_(pf, fStage);
    if (v < fTideWorstV){ fTideWorstV = v; fTideWorst = { n:t.n, pref:pf, v:v }; }
  });
  /* 계절 대표 어종들의 평균이 아니라 「제철 1순위 어종」 기준으로 본다.
     제철 어종이 물때 안 맞으면 그날은 공치기 쉽다. */
  if (fSeason.length){
    var top = fSeason[0];
    var pf0 = FISH_TIDE[top.n];
    if (pf0) fTideFit = tideStageFit_(pf0, fStage);
  }

  /* 사리냐 조금이냐 — 들물·날물과는 다른 축이다.
     조차가 작은 바다에는 대지 않는다(동해는 30센티미터라 이 축이 의미가 없다). */
  var fSpringFit = 1, fSpringWho = null;
  if (p.mr >= 1.5 && fSeason.length){
    var sp0 = FISH_SPRING[fSeason[0].n];
    if (sp0 !== undefined){
      fSpringFit = springFit_(sp0, expo);
      fSpringWho = { n: fSeason[0].n, pref: sp0, v: fSpringFit };
    }
  }
  var fRaw = sFeed + sFlow + sSea + sSst + sPres + sTurb;
  /* 물때가 안 맞으면 최대 40%까지 깎는다 — 아예 0으로 만들진 않되(다른 어종 여지) 상위 노출은 막는다 */
  fRaw = fRaw * (0.60 + 0.40 * fTideFit);
  /* 사리·조금은 들물·날물보다 영향이 작다. 최대 18%만 가감한다. */
  fRaw = fRaw * (0.82 + 0.18 * fSpringFit);
  var fCap = 100;
  if (fTideFit < 0.35) fCap = Math.min(fCap, 45);   // 제철어가 물때 안 맞으면 상단 배제
  if (fWx.wave !== null){
    if (fWx.wave >= 2.5) fCap = Math.min(fCap, 20);
    else if (fWx.wave >= 1.8) fCap = Math.min(fCap, 36);
    else if (fWx.wave >= 1.3) fCap = Math.min(fCap, 54);
  }
  if (fWx.wind !== null){
    if (we.eff >= 14) fCap = Math.min(fCap, 28);
    else if (we.eff >= 11) fCap = Math.min(fCap, 48);
  }
  if (day.rainSum !== null && day.rainSum >= 30) fCap = Math.min(fCap, 42);
  if (fWx.rain !== null && fWx.rain >= 8) fCap = Math.min(fCap, 38);
  // 낚싯대는 탄소 — 뇌우에는 들지 않는다
  if (fSky.storm) fCap = Math.min(fCap, 10);
  if (fSky.fog) fCap = Math.min(fCap, fWx.vism !== null && fWx.vism < 500 ? 30 : 52);
  if (fSky.freeze) fCap = Math.min(fCap, 24);   // 갯바위 결빙
  if (fChil !== null && fChil <= -2) fCap = Math.min(fCap, 32);
  var fScore = Math.round(Math.min(fRaw, fCap));

  var fWhy = [], fWarn = [];
  if (fo.ov > 1.2) fWhy.push('물돌이와 피딩타임이 겹침');
  else if (fo.ov > 0) fWhy.push('물돌이가 여명·황혼에 걸림');
  else fWarn.push('물돌이와 피딩타임이 어긋남');
  if (solV > 0.62) fWhy.push('달 활동기(솔루나)와 겹침');
  if (flow.fit > 0.72) fWhy.push('조류 ' + flow.peak.toFixed(1) + '노트 — 알맞음');
  else if (flow.peak > 2.2) fWarn.push('조류 ' + flow.peak.toFixed(1) + '노트 — 채비가 안 섬');
  else if (flow.peak < 0.25 && p.mr > 0.4) fWarn.push('조류 거의 없음 — 입질 뜸함');
  if (fTideWorst && fTideWorstV < 0.4){
    var PW = { flood:'들물(밀물)', ebb:'날물(썰물)', high:'만조 부근', low:'간조 부근', move:'물 움직일 때' };
    fWarn.push(fTideWorst.n + '은(는) ' + (PW[fTideWorst.pref]||'맞는 물때') + '에 잘 됩니다 — 이 시각 물때가 안 맞습니다');
  } else if (fSeason.length && FISH_TIDE[fSeason[0].n] && fTideFit > 0.7){
    var PW2 = { flood:'들물', ebb:'날물', high:'만조', low:'간조', move:'물 흐를 때' };
    fWhy.push(fSeason[0].n + ' 물때(' + (PW2[FISH_TIDE[fSeason[0].n]]||'') + ')가 맞음');
  }
  if (fSpringWho){
    var SW = { '1':'사리', '-1':'조금', '0.5':'중간물때' };
    var sw = SW[String(fSpringWho.pref)];
    if (fSpringWho.v < 0.6) fWarn.push(fSpringWho.n + '은(는) ' + sw + ' 물때가 낫습니다 — 오늘은 ' + mul.name);
    else if (fSpringWho.v > 0.88) fWhy.push(fSpringWho.n + '에 맞는 ' + sw + ' 물때 (' + mul.name + ')');
  }
  if (fBestName && fTherm > 0.75) fWhy.push('수온이 ' + fBestName + '에 맞음');
  if (fCatchV >= 2 && fCatchName) fWhy.push('실제 조황 — 이맘때 이 지역 ' + fCatchName + ' 조과 보고 많음');
  if (fWx.sst !== null && fTherm < 0.35) fWarn.push('수온 ' + fWx.sst.toFixed(1) + '도 — 대상어 적정에서 벗어남');
  if (dp <= -2 && dp > -9) fWhy.push('기압 하강 국면 — 활성 상승');
  else if (dp <= -9) fWarn.push('기압 급강하 — 날씨가 무너지는 중');
  if (fWx.wave !== null && fWx.wave >= 1.5) fWarn.push('파고 ' + fWx.wave.toFixed(1) + 'm — 갯바위 출조 금지 수준');
  else if (fWx.wave !== null && fWx.wave <= 0.5) fWhy.push('바다 잔잔함');
  if (we.wo.word && fWx.wind !== null && fWx.wind >= 3){
    if (we.wo.on > 0.3 && fWx.wind >= 8) fWarn.push('맞바람 ' + Math.round(fWx.wind) + 'm/s — 파도가 발밑을 때리고 채비가 안 날아감');
    else if (we.wo.on > 0.3 && fWx.wind <= 6) fWhy.push('알맞은 맞바람 — 베이트가 연안으로 몰림');
    else if (we.wo.on < -0.3 && fWx.wind >= 8) fWhy.push('등바람이라 체감 바람 덜함, 캐스팅 편함');
  }
  if (fWx.wind !== null && we.eff >= 11) fWarn.push('체감 바람 ' + Math.round(we.eff) + 'm/s — 캐스팅 어려움');
  if (visF.vis >= 3) fWhy.push('물색 맑음 (시야 ' + visF.vis.toFixed(1) + 'm)');
  else if (visF.vis < 0.6) fWarn.push('물이 탁함 (시야 ' + Math.round(visF.vis*100) + 'cm) — 루어 시인성 낮음');
  // 하늘 — 피딩타임 기준
  if (fSky.storm) fWarn.unshift('뇌우 예보 — 낚싯대는 탄소 도체입니다. 출조 금지');
  else if (fSky.fog) fWarn.unshift('안개' + (fWx.vism !== null ? ' (시정 ' + Math.round(fWx.vism) + 'm)' : '')
                                   + ' — 선상·갯바위 모두 위험');
  else if (fSky.freeze) fWarn.unshift('얼어붙는 비 — 갯바위 결빙, 진입 금지');
  else if (fSky.snow) fWarn.push('눈 — 발판 미끄러움');
  if (fBite > 0.35) fWhy.push(fWx.rain >= 0.3 ? '약한 비 — 수면이 깨져 경계심이 낮아짐' : '흐린 하늘 — 광량이 낮아 활성 좋음');
  else if (fWx.rain !== null && fWx.rain >= 8) fWarn.push('시간당 ' + fWx.rain.toFixed(1) + 'mm 폭우 — 염분이 흐트러지고 입질이 끊김');
  else if (fWx.rain !== null && fWx.rain >= 3) fWarn.push('제법 내리는 비 — 물색 탁해짐');
  if (fChil !== null && fWx.feel !== null && fChil <= fWx.feel - 3){
    fWarn.push('비바람에 체감 ' + Math.round(fChil) + '도 — 방한·방수 필수');
  }
  if (fCap <= 40){
    var fRsn = fSky.storm ? '뇌우'
             : fSky.freeze ? '갯바위 결빙'
             : fSky.fog ? '안개'
             : (fWx.wave !== null && fWx.wave >= 1.3) ? '파고 ' + fWx.wave.toFixed(1) + 'm'
             : (fWx.wind !== null && we.eff >= 11) ? '바람 ' + Math.round(we.eff) + 'm/s'
             : (fWx.rain !== null && fWx.rain >= 8) ? '폭우'
             : (day.rainSum !== null && day.rainSum >= 30) ? '비 ' + Math.round(day.rainSum) + 'mm'
             : (fChil !== null && fChil <= -2) ? '한파' : '';
    fWarn.unshift('안전 경고' + (fRsn ? ' (' + fRsn + ')' : '') + ' — 갯바위·선상 모두 위험 수준');
  }

  /* ── 대상물과 금어기 ────────────────────── */
  /* 야행성 대상은 낮 물때에 앞세우면 안 된다.
     낙지·문어·주꾸미·꽃게는 낮에 펄과 돌 밑에 숨어 있어, 물이 아무리 잘 빠져도
     대낮에 걸어다녀서는 나오지 않는다. 점수에만 반영하고 목록은 그대로 두면
     "낮 10시에 꽃게" 같은 헛걸음 추천이 나간다. */
  var hSplit = splitByBan_(demoteMurky_(demoteNocturnal_(hSeason, lowT, sun), visQ).slice(0, 6), mo, d, p.r);
  var fSplit = splitByBan_(fSeason.slice(0, 6), mo, d, p.r);
  var hTargets = hSplit.ok.slice(0, 4), fTargets = fSplit.ok.slice(0, 4);
  if (!hTargets.length && hSplit.banned.length) hTargets = [];
  if (!hTargets.length && !hSplit.banned.length) hTargets = hAll.slice(0,2).map(function(n){return {n:n,v:1};});
  if (!fTargets.length && !fSplit.banned.length) fTargets = fAll.slice(0,2).map(function(n){return {n:n,v:1};});

  // 금어기라 못 잡는 게 있으면 그만큼 매력이 떨어진다
  if (hSplit.banned.length && !hTargets.length) hScore = Math.min(hScore, 34);
  if (fSplit.banned.length && !fTargets.length) fScore = Math.min(fScore, 34);

  var hWindow = lowT === null ? null : [lowT - 1.5, lowT + 1.5];
  var fWindow = [fo.from, fo.to];

  /* ── 접경지역 군 통제 ─────────
     강화 북부·서해5도는 철책 통문이 일몰 후 닫힌다. 여기는 실제로 못 들어가므로 점수를 낮춘다.
     그 밖의 지역은 야간 해루질이 정상적인 활동이므로 깎지 않는다 — 해루질은 원래 밤에 한다. */
  var hPre = '', fPre = '';
  if (typeof milOf_ === 'function'){
    var milLv = milOf_(p);
    if (milLv > 0 && sun.rise !== null && sun.set !== null){
      var night_ = function(t){ return t !== null && t !== undefined && (t < sun.rise - 0.5 || t > sun.set + 0.5); };
      var hMid = hWindow ? (hWindow[0] + hWindow[1]) / 2 : null;
      var fMid = fWindow ? (fWindow[0] + fWindow[1]) / 2 : null;
      if (milLv >= 2){
        if (night_(hMid)){ hScore = Math.min(hScore, 28); hPre = '군 통제로 밤에는 못 들어갑니다. '; hWarn.unshift('군 통제 — 이 물때는 일몰 뒤라 통문이 닫혀 들어갈 수 없습니다. 낮 간조인 날을 고르세요'); }
        if (night_(fMid)){ fScore = Math.min(fScore, 32); fPre = '군 통제로 야간 낚시가 안 됩니다. '; fWarn.unshift('군 통제 — 야간 낚시 금지 구역, 이 시간대 출입 불가'); }
      } else if (milLv >= 1) {
        if (night_(hMid)) hWarn.unshift('군 통제 해안 — 야간에는 통문이 닫힐 수 있으니 개방시간을 먼저 확인하세요');
        if (night_(fMid)) fWarn.unshift('군 통제 해안 — 야간 출입 가능 여부를 통문·어촌계에 확인하세요');
      }
    }
  }

  /* ── 어종 지정 검색 보정 ────────────────── */
  var wantInfo = null;
  if (want){
    wantInfo = applyWant_(p, want, mo, d, hAll, fAll, hWx, fWx, hSeason, fSeason);
    if (wantInfo.kind === 'haeru'){ hScore = Math.round(hScore * wantInfo.mul); }
    else if (wantInfo.kind === 'fish'){ fScore = Math.round(fScore * wantInfo.mul); }
  }

  return {
    meta: {
      date: ds, mul: mul.name, lunarDay: multtae_(age, p.s).lunarDay,
      moonBright: Math.round(moonBright_(age)*100), moonLux: Math.round(lux*1000)/1000,
      luxWord: luxWord_(lux),
      range: Math.round(range*100)/100, src: tide.src,
      sunrise: sun.rise, sunset: sun.set, dawn: tw.rise, dusk: tw.set,
      events: ev, floor: FLOOR_KO[p.f] || '',
      ferry: p.isl ? ferryPlan_(lowT, hWx.wave, hWx.wind, p.fr ? p.fr[2] : 1) : null,
      vis: Math.round(vis.vis*100)/100, visQ: Math.round(visQ*100)/100, visWord: visWord,
      visLo: Math.round(vb2.lo*100)/100, visHi: Math.round(vb2.hi*100)/100, ssc: Math.round(vis.ssc),
      flatWidth: Math.round(width),
      wade: (typeof wadePlan_ === 'function') ? wadePlan_(lowT, range, p.f, width) : null,
      risk: (typeof riskOf_ === 'function') ? riskOf_(range, p.f) : null,
      runup: (typeof runupOf_ === 'function') ? runupOf_(fWx.wave, fWx.wper) : null,
      curPeak: Math.round(flow.peak*100)/100,
      solunar: { major: sol.major, minor: sol.minor, strength: Math.round(sol.strength*100),
                 moonrise: sol.ev.rise, moonset: sol.ev.set, transit: sol.ev.transit },
      press: Math.round(dp*10)/10,
      wx: { temp: hWx.temp, wind: fWx.wind, wave: fWx.wave, sst: fWx.sst,
            cloud: fWx.cloud, rain: fWx.rain, wdir: dirName_(fWx.wdir),
            onshore: we.wo.word, effWind: we.eff !== null && we.eff !== undefined ? Math.round(we.eff*10)/10 : null,
            sky: fSky.word, skyH: hSky.word, storm: hSky.storm || fSky.storm, fog: hSky.fog || fSky.fog,
            rainDay: day.rainSum === null ? null : Math.round(day.rainSum*10)/10,
            rainP: fWx.rainP === null || fWx.rainP === undefined ? null : Math.round(fWx.rainP),
            vism: fWx.vism === null || fWx.vism === undefined ? null : Math.round(fWx.vism),
            chillH: hChil === null ? null : Math.round(hChil*10)/10,
            chillF: fChil === null ? null : Math.round(fChil*10)/10 },
      banned: { haeru: hSplit.banned, fish: fSplit.banned },
      banMeta: (typeof banMetaNow_==='function' ? banMetaNow_() : BAN_META)
    },
    haeru: {
      score: Math.max(0, Math.min(100, hScore)), raw: Math.round(Math.min(hRaw,hCap)*100)/100,
      grade: grade_(hScore), window: hWindow, lowTime: lowT, lowLevel: nl ? nl.ev.lv : null,
      why: hWhy, warn: hWarn, targets: hTargets, bannedTargets: hSplit.banned,
      parts: { 시야: Math.round(sVis), 노출: Math.round(sExpo), 타이밍: Math.round(sTime),
               안전: Math.round(sSafe), 활성: Math.round(sLive) },
      partsMax: { 시야: Math.round(32*vw), 노출: Math.round(26 + 32*(1 - vw)),
                  타이밍: 18, 안전: 16, 활성: 8 },
      verdict: hPre + verdictHaeru_(p, hScore, hWindow, hTargets, vis, hSplit.banned)
    },
    fish: {
      score: Math.max(0, Math.min(100, fScore)), raw: Math.round(Math.min(fRaw,fCap)*100)/100,
      grade: grade_(fScore), window: fWindow, pivot: fo.ev ? { k: fo.ev.k, t: fo.ev.t } : null,
      why: fWhy, warn: fWarn, targets: fTargets, bannedTargets: fSplit.banned,
      parts: { 피딩: Math.round(sFeed), 조류: Math.round(sFlow), 해상: Math.round(sSea),
               수온: Math.round(sSst), 기압: Math.round(sPres), 물색: Math.round(sTurb) },
      verdict: fPre + verdictFish_(p, fScore, fWindow, fTargets, fo, flow)
    },
    want: wantInfo
  };
}

/** 어종을 지정했을 때의 배수와 설명 */
function applyWant_(p, want, mo, d, hAll, fAll, hWx, fWx, hSeason, fSeason){
  var isH = hAll.indexOf(want) >= 0, isF = fAll.indexOf(want) >= 0;
  if (!isH && !isF) return { kind:null, mul:0.12, has:false, reason: want + '을(를) 노릴 자리가 아닙니다' };
  var kind = isH ? 'haeru' : 'fish';
  var table = isH ? SEASON_SP : SEASON_FX;
  var sst = isH ? hWx.sst : fWx.sst;
  var seasonV = table[want] ? table[want][mo-1] : 1;
  var th = thermalFit_(want, sst);
  var ban = banStatus_(want, mo, d, p.r);
  var mul = (0.35 + 0.45*clamp01_(seasonV/3) + 0.20*th);
  var reason;
  if (ban && ban.banned){
    mul = 0.05;
    reason = want + '은(는) ' + ban.from + '~' + ban.to + ' 금어기입니다 (' + ban.scope + ')';
  } else if (seasonV === 0) reason = want + ' 철이 아닙니다';
  else if (seasonV >= 3)    reason = want + ' 제철';
  else                      reason = want + ' 시즌 초입';
  return { kind: kind, mul: mul, has: true, season: seasonV, thermal: Math.round(th*100),
           ban: ban, reason: reason, name: want };
}


/* 대상 순서 — 제철 점수만 쓰면 어디나 「낙지·바지락」이 앞에 서서 결론이 똑같아진다.
   그 해역·이맘때 실제 조황 강도와, 그 해역 포인트들 사이에서 드문 종일수록(희소성) 가점을 줘
   백사장항의 대하, 벌교의 꼬막, 갯바위의 굴처럼 그 자리만의 특징 종이 앞에 나오게 한다. */
var _SPFREQ = null;
function speciesFreq_(){
  if (_SPFREQ) return _SPFREQ;
  var f = {}, n = {};
  for (var i = 0; i < POINTS.length; i++){
    var q = POINTS[i], z = zoneOf_(q);
    n[z] = (n[z] || 0) + 1;
    var seen = {};
    (q.sp || []).concat(q.fx || []).forEach(function(nm){ if (seen[nm]) return; seen[nm] = 1; f[z] = f[z] || {}; f[z][nm] = (f[z][nm] || 0) + 1; });
  }
  _SPFREQ = { f: f, n: n };
  return _SPFREQ;
}
function rankTargets_(list, p, mo, kind){
  try {
    var z = zoneOf_(p), fq = speciesFreq_();
    var tot = (fq.n[z] || 1), row = fq.f[z] || {};
    var listOrder = (kind === 'haeru' ? (p.sp || []) : (p.fx || []));
    list.forEach(function(t, idx){
      var cv = catchAt_(t.n, z, mo);                       // 실제 조황 0~2, 없으면 중립
      var catchB = (cv === null) ? 0.5 : cv * 0.5;           // 0~1
      var rare = 1 - Math.min(1, (row[t.n] || 0) / tot);    // 해역 내 희소성 0~1
      var pos = listOrder.indexOf(t.n);                      // 자료가 앞세운 순서(대표종)도 존중
      var posB = pos < 0 ? 0 : Math.max(0, 0.9 - pos * 0.3);
      /* 후기에서 유독 이 자리에서 많이 언급된 종(특산) — 실제로 잡힌 기록이니 가장 크게 본다 */
      var sigB = (p.sig && p.sig.indexOf(t.n) >= 0) ? 1.2 : 0;
      t.sig = sigB > 0;
      t.k = t.v + 0.8 * catchB + 0.5 * rare + posB + sigB;
    });
    list.sort(function(a, b){ return b.k - a.k; });
  } catch(e){}
  return list;
}

function grade_(s){
  if (s >= 88) return 'S';
  if (s >= 76) return 'A';
  if (s >= 62) return 'B';
  if (s >= 46) return 'C';
  return 'D';
}

function verdictHaeru_(p, s, win, tg, vis, banned){
  if (banned && banned.length && !tg.length)
    return banned[0].n + ' 금어기라 오늘 이 자리는 의미가 없습니다.';
  // 흐린 물·낮 물때로 강등된 대상은 결론 문장에서 뺀다 — 앞세워 놓고 헛걸음시키지 않는다
  var solid = tg.filter(function(t){ return !t.murk && !t.night; });
  var names = (solid.length ? solid : tg).slice(0,2).map(function(t){ return t.n; }).join('·');
  if (!win) return p.n + ' — 오늘은 물이 안 빠져서 들어갈 자리가 없습니다.';
  var t = fmtRange_(win[0], win[1]);
  var v = (vis.q != null)
    ? (vis.q >= 0.6 ? ' 물도 이 바다치고 맑은 편입니다.' : (vis.q < 0.18 ? ' 다만 물이 많이 탁합니다.' : ''))
    : '';
  if (s >= 88) return t + '에 들어가서 ' + names + ' 담으면 됩니다.' + v;
  if (s >= 76) return t + ' 사이에 ' + names + ' 노리세요.' + v;
  if (s >= 62) return t + '에 ' + names + ' 정도는 봅니다. 무난한 수준.';
  if (s >= 46) return '굳이 간다면 ' + t + '. ' + names + ' 조금 나오는 정도입니다.';
  return '오늘 여기는 접으세요. 조건이 안 맞습니다.';
}
function verdictFish_(p, s, win, tg, fo, flow){
  var names = tg.slice(0,2).map(function(t){ return t.n; }).join('·');
  var t = fmtRange_(win[0], win[1]);
  var pv = fo.ev ? (fo.ev.k === 'H' ? '만조' : '간조') + ' ' + fmtH_(fo.ev.t) : '';
  if (s >= 88) return t + ' (' + pv + ' 전후, 조류 ' + flow.peak.toFixed(1) + '노트)에 ' + names + '.';
  if (s >= 76) return t + '에 ' + names + ' 노리세요. ' + pv + ' 물돌이가 핵심입니다.';
  if (s >= 62) return t + ' 정도가 그나마 낫습니다. 대상어는 ' + names + '.';
  if (s >= 46) return '조건 애매합니다. 굳이 간다면 ' + t + ', ' + names + '.';
  return '오늘 출조는 비추천입니다.';
}


/* ══════════ 야행성 보정 ══════════
 * 작업 시간대(간조 앞뒤)가 훤한 낮이면 야행성 대상을 뒤로 미룬다.
 * 아예 지우지는 않는다 — 물때가 밤으로 넘어가는 날을 고르라는 뜻이지
 * 그 자리에 아예 없다는 뜻은 아니기 때문이다. */
var NOCTURNAL = { '낙지':1, '문어':1, '주꾸미':1, '꽃게':1, '박하지':1,
                  '왕밤송이게':1, '톱날꽃게':1, '갯가재':1, '대수리':1 };
function isNocturnal_(n){ return !!NOCTURNAL[n]; }

/* 간조 시각이 낮 한복판이면 1, 완전한 밤이면 0 */
function daylightAt_(t, sun){
  if (t === null || t === undefined || !sun) return 0;
  var rise = sun.rise, set = sun.set;
  if (rise === null || set === null) return 0;
  if (t <= rise - 0.7 || t >= set + 0.7) return 0;          // 확실한 밤
  if (t >= rise + 1.0 && t <= set - 1.0) return 1;          // 확실한 낮
  return 0.5;                                              // 여명·땅거미
}
/* 눈으로 찾아 잡는 대상 — 물이 흐리면 랜턴을 비춰도 안 보인다.
 * 꽃게 뜰채질·문어 웅덩이 사냥이 여기 해당한다. 호미로 파는 조개는 무관하다. */
/* 호미로 파거나 손으로 떼는 대상 — 물이 빠진 뒤라 물속 시야와 상관이 없다 */
var DIG_ = {
  '바지락':1,'동죽':1,'백합':1,'가무락':1,'모시조개':1,'꼬막':1,'맛조개':1,'가리맛조개':1,
  '대맛':1,'홍맛':1,'개조개':1,'명주조개':1,'떡조개':1,'서해비단조개':1,'키조개':1,
  '개불':1,'갯지렁이':1,'칠게':1,'굴':1,'홍합':1,'거북손':1,'따개비':1,'미역':1,'톳':1,'고둥':1,'보말':1
};
var SIGHT_HUNT = { '꽃게':1, '문어':1, '주꾸미':1, '박하지':1, '갯가재':1, '톱날꽃게':1 };
function demoteMurky_(list, visQ){
  if (visQ >= 0.18) return list;
  var out = list.map(function(t){
    if (!SIGHT_HUNT[t.n]) return t;
    return { n: t.n, v: Math.max(0.3, t.v * 0.5), k: (t.k != null ? t.k * 0.5 : undefined), murk: 1 };
  });
  out.sort(function(a, b){ return (b.k != null ? b.k : b.v) - (a.k != null ? a.k : a.v); });
  return out;
}

function demoteNocturnal_(list, lowT, sun){
  var dl = daylightAt_(lowT, sun);
  if (dl <= 0) return list;                                 // 밤 물때면 손대지 않는다
  var out = list.map(function(t){
    if (!isNocturnal_(t.n)) return t;
    return { n: t.n, v: Math.max(0.4, t.v * (dl >= 1 ? 0.34 : 0.7)), k: (t.k != null ? t.k * (dl >= 1 ? 0.34 : 0.7) : undefined), night: 1 };
  });
  out.sort(function(a, b){ return (b.k != null ? b.k : b.v) - (a.k != null ? a.k : a.v); });
  return out;
}

/** 앱에서 고를 수 있는 대상 목록 (검색 화면용) */
function allSpecies_(kind){
  var seen = {}, out = [];
  var tables = kind === 'fish'
    ? [FX_DEFAULT, (typeof FX_BY === 'object' ? FX_BY : {})]
    : [SP_DEFAULT];
  tables.forEach(function(table){
    for (var k in table) table[k].forEach(function(n){ if (!seen[n]){ seen[n] = 1; out.push(n); } });
  });
  (typeof pool_==='function' ? pool_() : POINTS).forEach(function(p){
    var arr = kind === 'fish' ? p.fx : p.sp;
    if (arr) arr.forEach(function(n){ if (!seen[n]){ seen[n] = 1; out.push(n); } });
  });
  return out;
}
