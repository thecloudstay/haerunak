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
  var sExpo = 28 * (0.42*wIdx + 0.34*expo + 0.24*clamp01_(range/3.2)) * floorK;

  // 수중 시야 — 파랑이 바닥을 흔들고, 조류·강우가 흙을 실어 나른다
  var vis = underwaterVis_({
    wave: hWx.wave, period: hWx.wper, floor: p.f,
    current: Math.abs(hCur), rain24: day.rainSum, month: mo
  });
  var sVis = 22 * clamp01_((Math.log(vis.vis) - Math.log(0.25)) / (Math.log(4.0) - Math.log(0.25)));

  var sTime = 20 * (nl ? nl.timing : 0.3);

  var hWe = windEffect_(p, hWx.wind, hWx.wdir);
  var sSafe = 18 * (0.34*lerpDown_(hWe.eff, 4, 13)
                  + 0.28*lerpDown_(hWx.wave, 0.25, 1.1)
                  + 0.22*band_(hWx.feel, 8, 30, 12)
                  + 0.16*lerpDown_(Math.abs(toKnot_(hCur)), 0.6, 2.4));

  // 대상 활성 — 수온 적정 + 제철 + 야행성 보정
  var hAll = speciesOf_(p, 'haeru');
  var hSeason = inSeason_(hAll, mo, SEASON_SP);
  var hTherm = 0;
  hSeason.forEach(function(t){ var v = thermalFit_(t.n, hWx.sst); if (v > hTherm) hTherm = v; });
  var lux = moonLux_(y, mo, d, lowT === null ? 21 : lowT, p.la, p.lo, age);
  var nocturn = clamp01_(1 - Math.min(1, lux/0.22)*0.45) ;   // 어두울수록 문어·낙지 유리
  var sLive = 12 * (0.5*hTherm + 0.28*clamp01_((hSeason.length ? hSeason[0].v : 1)/3) + 0.22*nocturn);

  var hRaw = sExpo + sVis + sTime + sSafe + sLive;

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
  if (hWx.feel !== null && hWx.feel <= 2) hCap = Math.min(hCap, 42);
  if (vis.vis < 0.25) hCap = Math.min(hCap, 45);
  if (p.f === 'none') hCap = Math.min(hCap, 28);
  var hScore = Math.round(Math.min(hRaw, hCap));

  var hWhy = [], hWarn = [];
  if (wIdx > 0.7) hWhy.push('갯벌이 ' + (width >= 1000 ? (width/1000).toFixed(1) + 'km' : Math.round(width/10)*10 + 'm') + ' 가량 드러남');
  if (expo > 0.72) hWhy.push('사리 물때 (' + mul.name + ')');
  else if (expo < 0.3) hWarn.push('조금 물때 — 얕게만 빠짐');
  if (nl && nl.timing > 0.8) hWhy.push('간조가 밤 시간대에 딱 걸림');
  else if (nl && nl.timing < 0.45) hWarn.push('간조가 낮이라 야간 작업 창이 짧음');
  if (vis.vis >= 2) hWhy.push('수중 시야 ' + vis.vis.toFixed(1) + 'm — ' + vis.word);
  else if (vis.vis < 0.6) hWarn.push('수중 시야 ' + Math.round(vis.vis*100) + 'cm — ' + vis.word);
  if (vis.R > 1.4) hWarn.push('파랑이 바닥을 흔들어 흙탕물');
  if (lux < 0.02) hWhy.push('달 없는 밤 — 문어·낙지 활동 좋음');
  else if (lux > 0.18) hWarn.push('달이 밝아 야행성 대상이 숨음');
  if (Math.abs(toKnot_(hCur)) >= 1.6) hWarn.push('조류 ' + Math.abs(toKnot_(hCur)).toFixed(1) + '노트 — 발 밑 조심');
  if (hWx.wind !== null && hWe.eff >= 9) hWarn.push((hWe.wo.word||'바람') + ' ' + Math.round(hWx.wind) + 'm/s — 체온 손실·물결 주의');
  if (p.f === 'none') hWarn.push('조차가 작아 갯벌 노출이 거의 없음');
  if (hCap <= 45) hWarn.unshift('안전 경고 — 오늘 이 지점 입수는 권하지 않습니다');

  /* ── 낚시 ───────────────────────────────── */
  var fo   = feedOverlap_(ev, tw.rise, tw.set, sun.rise, sun.set);
  var fMid = (fo.from + fo.to)/2;
  var fWx  = wxAt_(wxRec, ((fMid % 24) + 24) % 24);
  var sol  = solunar_(y, mo, d, p.la, p.lo, age);
  var solV = solunarAt_(sol, ((fMid % 24) + 24) % 24);
  var flow = flowFit_(p, tide, fo.from, fo.to);
  var visF = underwaterVis_({ wave: fWx.wave, period: fWx.wper, floor: p.f,
                              current: flow.peak/1.94, rain24: day.rainSum, month: mo, depth: 3 });

  var sFeed = 28 * clamp01_(0.30 + (fo.ov > 0 ? fo.ov/3.2*0.40 : 0) + solV*0.30);
  var sFlow = 18 * (p.mr > 0.4 ? (0.6*flow.fit + 0.4*band_(relRange, 0.5, 0.92, 0.42)) : 0.68);
  // 바람은 방향까지 본다 — 등바람은 체감을 깎고, 알맞은 맞바람은 활성 가점
  var we = windEffect_(p, fWx.wind, fWx.wdir);
  var sSea  = 20 * (0.55*lerpDown_(fWx.wave, 0.25, 1.8)
                  + 0.33*lerpDown_(we.eff, 3.5, 13)
                  + 0.12*we.bonus);

  var fAll = speciesOf_(p, 'fish');
  var fSeason = inSeason_(fAll, mo, SEASON_FX);
  var fTherm = 0, fBestName = null;
  fSeason.forEach(function(t){
    var v = thermalFit_(t.n, fWx.sst) * (0.6 + t.v*0.1333);
    if (v > fTherm){ fTherm = v; fBestName = t.n; }
  });
  var sSst = 16 * clamp01_(fTherm);

  var dp = pressTrend_(wxRec ? wxRec.pres : null, fMid);
  var sPres = 8 * pressScore_(dp);
  // 물색 — 맑을수록 좋다 (0.3m에서 0점, 6m 이상이면 만점)
  var sTurb = 10 * clamp01_((Math.log(Math.max(0.05, visF.vis)) - Math.log(0.3)) / (Math.log(6) - Math.log(0.3)));

  var fRaw = sFeed + sFlow + sSea + sSst + sPres + sTurb;
  var fCap = 100;
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
  var fScore = Math.round(Math.min(fRaw, fCap));

  var fWhy = [], fWarn = [];
  if (fo.ov > 1.2) fWhy.push('물돌이와 피딩타임이 겹침');
  else if (fo.ov > 0) fWhy.push('물돌이가 여명·황혼에 걸림');
  else fWarn.push('물돌이와 피딩타임이 어긋남');
  if (solV > 0.62) fWhy.push('달 활동기(솔루나)와 겹침');
  if (flow.fit > 0.72) fWhy.push('조류 ' + flow.peak.toFixed(1) + '노트 — 알맞음');
  else if (flow.peak > 2.2) fWarn.push('조류 ' + flow.peak.toFixed(1) + '노트 — 채비가 안 섬');
  else if (flow.peak < 0.25 && p.mr > 0.4) fWarn.push('조류 거의 없음 — 입질 뜸함');
  if (fBestName && fTherm > 0.75) fWhy.push('수온이 ' + fBestName + '에 맞음');
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
  if (fCap <= 40) fWarn.unshift('안전 경고 — 갯바위·선상 모두 위험 수준');

  /* ── 대상물과 금어기 ────────────────────── */
  var hSplit = splitByBan_(hSeason.slice(0, 6), mo, d, p.r);
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
      vis: Math.round(vis.vis*100)/100, visWord: vis.word, ssc: Math.round(vis.ssc),
      flatWidth: Math.round(width),
      curPeak: Math.round(flow.peak*100)/100,
      solunar: { major: sol.major, minor: sol.minor, strength: Math.round(sol.strength*100),
                 moonrise: sol.ev.rise, moonset: sol.ev.set, transit: sol.ev.transit },
      press: Math.round(dp*10)/10,
      wx: { temp: hWx.temp, wind: fWx.wind, wave: fWx.wave, sst: fWx.sst,
            cloud: fWx.cloud, rain: fWx.rain, wdir: dirName_(fWx.wdir),
            onshore: we.wo.word, effWind: we.eff !== null && we.eff !== undefined ? Math.round(we.eff*10)/10 : null },
      banned: { haeru: hSplit.banned, fish: fSplit.banned },
      banMeta: (typeof banMetaNow_==='function' ? banMetaNow_() : BAN_META)
    },
    haeru: {
      score: Math.max(0, Math.min(100, hScore)), raw: Math.round(Math.min(hRaw,hCap)*100)/100,
      grade: grade_(hScore), window: hWindow, lowTime: lowT, lowLevel: nl ? nl.ev.lv : null,
      why: hWhy, warn: hWarn, targets: hTargets, bannedTargets: hSplit.banned,
      parts: { 노출: Math.round(sExpo), 시야: Math.round(sVis), 타이밍: Math.round(sTime),
               안전: Math.round(sSafe), 활성: Math.round(sLive) },
      verdict: verdictHaeru_(p, hScore, hWindow, hTargets, vis, hSplit.banned)
    },
    fish: {
      score: Math.max(0, Math.min(100, fScore)), raw: Math.round(Math.min(fRaw,fCap)*100)/100,
      grade: grade_(fScore), window: fWindow, pivot: fo.ev ? { k: fo.ev.k, t: fo.ev.t } : null,
      why: fWhy, warn: fWarn, targets: fTargets, bannedTargets: fSplit.banned,
      parts: { 피딩: Math.round(sFeed), 조류: Math.round(sFlow), 해상: Math.round(sSea),
               수온: Math.round(sSst), 기압: Math.round(sPres), 물색: Math.round(sTurb) },
      verdict: verdictFish_(p, fScore, fWindow, fTargets, fo, flow)
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
  var names = tg.slice(0,2).map(function(t){ return t.n; }).join('·');
  if (!win) return p.n + ' — 오늘은 물이 안 빠져서 들어갈 자리가 없습니다.';
  var t = fmtRange_(win[0], win[1]);
  var v = vis.vis >= 1.5 ? ' 물도 봐줄 만합니다.' : (vis.vis < 0.5 ? ' 다만 물이 많이 탁합니다.' : '');
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

/** 앱에서 고를 수 있는 대상 목록 (검색 화면용) */
function allSpecies_(kind){
  var seen = {}, out = [];
  var table = kind === 'fish' ? FX_DEFAULT : SP_DEFAULT;
  for (var k in table) table[k].forEach(function(n){ if (!seen[n]){ seen[n] = 1; out.push(n); } });
  POINTS.forEach(function(p){
    var arr = kind === 'fish' ? p.fx : p.sp;
    if (arr) arr.forEach(function(n){ if (!seen[n]){ seen[n] = 1; out.push(n); } });
  });
  return out;
}
