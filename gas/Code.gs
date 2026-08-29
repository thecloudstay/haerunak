/**
 * 해루낚 — 진입점과 화면 연동 API
 * 배포: 배포 > 새 배포 > 웹 앱 / 실행: 나 / 액세스: 모든 사용자
 */

var CFG = {
  TZ: 'Asia/Seoul',
  BOARD_CACHE_SEC: 1800,
  PRECISE_TOP: 10
};

function doGet(e){
  // 레퍼럴 유입 기록 — ?ref=유튜버코드
  var ref = e && e.parameter && e.parameter.ref ? String(e.parameter.ref).replace(/[^\w-]/g,'').slice(0,24) : '';
  if (ref) trackRef_(ref, 'visit');

  var t = HtmlService.createTemplateFromFile('Index');
  t.BOOT = JSON.stringify({
    today: todayStr_(),
    count: (typeof pool_==='function' ? pool_().length : POINTS.length),
    indexCount: allIndex_().length,
    species: { haeru: allSpecies_('haeru'), fish: allSpecies_('fish') },
    ban: (typeof banMetaNow_==='function' ? banMetaNow_() : BAN_META),
    nonpro: NONPRO,
    ferry: (typeof ferryInfo_==='function' ? ferryInfo_() : null),
    ref: ref
  });
  return t.evaluate()
    .setTitle('해루낚 — 오늘 어디서 뭘 잡지')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
    .addMetaTag('theme-color', '#05141f')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(f){ return HtmlService.createHtmlOutputFromFile(f).getContent(); }
function todayStr_(){ return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'); }

/**
 * 지도 보드
 * @param opts {want:'낙지', isl:true|false|null, car:true}
 */
function apiBoard(ds, mode, opts){
  ds = ds || todayStr_();
  mode = (mode === 'fish') ? 'fish' : 'haeru';
  opts = opts || {};
  var cache = CacheService.getScriptCache();
  var ck = 'b5_' + ds + '_' + mode + '_' + (opts.want || '') + '_' + (opts.isl === null || opts.isl === undefined ? 'a' : (opts.isl ? 'i' : 'l')) + (opts.car ? 'c' : '');
  var hit = cache.get(ck);
  if (hit){ try { return JSON.parse(hit); } catch(e){} }

  var pool = (typeof pool_==='function' ? pool_() : POINTS).filter(function(p){
    if (opts.isl === true  && !p.isl) return false;
    if (opts.isl === false &&  p.isl) return false;
    // 다리로 이어진 섬은 배편 정보가 없다 — 그것도 차로 가는 섬이다
    if (opts.car && p.isl && p.fr && !p.fr[2]) return false;
    if (opts.want){
      var arr = speciesOf_(p, mode);
      if (arr.indexOf(opts.want) < 0) return false;
    }
    return true;
  });
  if (!pool.length) return { ds: ds, mode: mode, rows: [], empty: true,
                             msg: opts.want ? (opts.want + '을(를) 노릴 포인트가 조건에 없습니다') : '조건에 맞는 포인트가 없습니다' };

  var wx = fetchWeather_(pool, ds);
  var rows = pool.map(function(p){
    var tide = tideOf_(p, ds, false);
    return packRow_(p, analyze_(p, ds, tide, wx[gridKey_(p.la, p.lo)], opts.want), mode);
  });
  // 실제 조황 기록으로 미세 보정 (기록 3건 이상 지점만, ±4점)
  try {
    var bm = catchBoostMap_();
    rows.forEach(function(r){
      var b = bm[r.i + '|' + mode];
      if (b){ r.score = Math.max(0, Math.min(100, r.score + b)); r.raw += b; r.boost = b; }
    });
  } catch(e){}
  rows.sort(function(a,b){ return b.raw - a.raw; });

  // 상위 지점만 바다타임으로 정밀 보정
  var top = rows.slice(0, CFG.PRECISE_TOP);
  try {
    var resp = UrlFetchApp.fetchAll(top.map(function(r){
      return { url: 'https://m.badatime.com/' + r.i + '.html', muteHttpExceptions: true, followRedirects: true,
               headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' } };
    }));
    resp.forEach(function(res, k){
      if (res.getResponseCode() !== 200) return;
      var parsed;
      try { parsed = parseBadatime_(res.getContentText('UTF-8')); } catch(e){ return; }
      if (!parsed || !parsed[ds]) return;
      try { cache.put('bt_' + top[k].i, JSON.stringify(parsed), 21600); } catch(e){}
      var p = pointById_(top[k].i);
      if (!p) return;
      var fresh = packRow_(p, analyze_(p, ds, parsed[ds], wx[gridKey_(p.la, p.lo)], opts.want), mode);
      for (var key in fresh) top[k][key] = fresh[key];
    });
  } catch(e){}
  rows.sort(function(a,b){ return b.raw - a.raw; });

  var out = { ds: ds, mode: mode, want: opts.want || null, rows: rows,
              total: (typeof pool_==='function' ? pool_().length : POINTS.length), shown: rows.length,
              generated: Utilities.formatDate(new Date(), CFG.TZ, 'HH:mm') };
  try { cache.put(ck, JSON.stringify(out), CFG.BOARD_CACHE_SEC); } catch(e){}
  return out;
}

function packRow_(p, an, mode){
  var m = mode === 'fish' ? an.fish : an.haeru;
  return {
    i: p.i, n: p.n, r: p.r, s: p.s, la: p.la, lo: p.lo, tag: p.tag || '',
    isl: p.isl ? 1 : 0, fr: p.fr || null,
    score: m.score, raw: m.raw, grade: m.grade,
    win: m.window ? [Math.round(m.window[0]*60), Math.round(m.window[1]*60)] : null,
    targets: m.targets.map(function(t){ return t.n; }),
    banned: (m.bannedTargets || []).map(function(t){ return t.n; }),
    verdict: m.verdict, why: (m.why||[]).slice(0,2), warn: (m.warn||[]).slice(0,2),
    mul: an.meta.mul, range: an.meta.range, src: an.meta.src,
    vis: an.meta.vis, visQ: an.meta.visQ, visWord: an.meta.visWord, cur: an.meta.curPeak,
    other: (mode === 'fish' ? an.haeru.score : an.fish.score),
    wantReason: an.want ? an.want.reason : null,
    // 원픽 자리에 걸 영상 — 유튜버에게 주는 대가이자 나중의 광고 자리
    vid: (typeof pickVideo_ === 'function')
      ? pickVideo_(p.i, p.n, m.targets.map(function(t){ return t.n; }), mode)
      : null
  };
}

/** 지점 상세 — 항상 정밀 소스 */
function apiPoint(id, ds, want, days){
  ds = ds || todayStr_();
  var p = anyPoint_(id);
  if (!p) return { error: '지점을 찾을 수 없습니다.' };
  var tide = tideOf_(p, ds, true);
  var wx = fetchWeather_([p], ds);
  var an = analyze_(p, ds, tide, wx[gridKey_(p.la, p.lo)], want);
  return {
    point: { i:p.i, n:p.n, r:p.r||'', s:p.s, la:p.la, lo:p.lo, tag:p.tag||'',
             floor: FLOOR_KO[p.f], isl: p.isl?1:0, fr: p.fr||null,
             auto: !!p.auto, approxCoord: !!p.approxCoord },
    ds: ds, meta: an.meta, haeru: an.haeru, fish: an.fish, want: an.want,
    spots: spotsOf_(p.i),
    partners: (typeof apiPartners === 'function') ? apiPartners(p.i) : [],
    ad: (typeof pickAd_ === 'function')
      ? pickAd_(p.r || '', ds, 'haeru', (an.meta.banned.haeru || []).concat(an.meta.banned.fish || []).map(function(x){ return x.n; }))
      : null,
    gear: (typeof gearFor_ === 'function') ? gearFor_(an.meta, 'haeru', p.f) : [],
    rigs: (typeof rigsFor_ === 'function')
      ? { haeru: rigsFor_(an.haeru.targets, 'haeru'), fish: rigsFor_(an.fish.targets, 'fish'),
          safe: SAFE_KIT }
      : null,
    // 준비물에 걸린 제휴 링크 — 도구 이름을 상품군으로 묶어 한 번에 내려준다
    shop: (function(){
      if (typeof shopFor_ !== 'function' || typeof rigsFor_ !== 'function') return null;
      var names = [];
      ['haeru','fish'].forEach(function(m){
        (rigsFor_(m === 'haeru' ? an.haeru.targets : an.fish.targets, m) || [])
          .forEach(function(r){ (r.t || []).forEach(function(t){ names.push(t); }); });
      });
      SAFE_KIT.forEach(function(t){ names.push(t); });
      var items = shopFor_(names);
      return { items: items, disclosure: shopDisclosure_(items) };
    })(),
    videos: (typeof videosFor_ === 'function')
      ? { haeru: videosFor_((an.haeru.targets||[]).map(function(x){return x.n;}), 'haeru'),
          fish:  videosFor_((an.fish.targets ||[]).map(function(x){return x.n;}), 'fish') }
      : null,
    week: apiWeek_(p, ds, want, Math.min(15, Math.max(7, Number(days) || 7)))
  };
}

function apiWeek_(p, ds, want, days){
  var bt = fetchBadatime_(p.i);
  var days = [], base = new Date(ds + 'T00:00:00+09:00');
  for (var k = 0; k < (days || 7); k++)
    days.push(Utilities.formatDate(new Date(base.getTime() + k*86400000), CFG.TZ, 'yyyy-MM-dd'));
  var rec = fetchWeather_([p], ds)[gridKey_(p.la, p.lo)];
  return days.map(function(dd){
    var tide = (bt && bt[dd]) ? bt[dd]
      : (function(){ var a = dd.split('-'); return calcTide_(p, +a[0], +a[1], +a[2]); })();
    var an = analyze_(p, dd, tide, dd === ds ? rec : null, want);
    return { ds: dd, mul: an.meta.mul, range: an.meta.range,
             h: an.haeru.score, f: an.fish.score,
             vis: dd === ds ? an.meta.vis : null,   // 기상 예보가 있는 당일만 시야를 낸다
             hw: an.haeru.window ? [Math.round(an.haeru.window[0]*60), Math.round(an.haeru.window[1]*60)] : null,
             fw: an.fish.window ? [Math.round(an.fish.window[0]*60), Math.round(an.fish.window[1]*60)] : null };
  });
}

/** 전체 색인 검색 — 정식 포인트를 위로 올린다 */
function apiSearch(q){
  var hits = searchIndex_(q, 60);
  return hits.map(function(h){
    var p = pointById_(h.i);
    return { i: h.i, n: h.n, s: h.s, curated: !!p, r: p ? p.r : '', isl: p && p.isl ? 1 : 0 };
  }).sort(function(a,b){ return (b.curated?1:0) - (a.curated?1:0); });
}

/** 어종 목록 — 제철·금어기 상태를 붙여서 준다 */
function apiSpecies(ds, mode){
  ds = ds || todayStr_();
  var a = ds.split('-'), mo = +a[1], d = +a[2];
  var table = mode === 'fish' ? SEASON_FX : SEASON_SP;
  var PL_ = (typeof pool_==='function' ? pool_() : POINTS);
  return allSpecies_(mode === 'fish' ? 'fish' : 'haeru').map(function(n){
    var st = banStatus_(n, mo, d, '전국');
    var spots = 0;
    PL_.forEach(function(p){ if (speciesOf_(p, mode === 'fish' ? 'fish' : 'haeru').indexOf(n) >= 0) spots++; });
    return { n: n, season: table[n] ? table[n][mo-1] : 1, spots: spots,
             banned: !!(st && st.banned),
             pop: (typeof popRank_ === 'function') ? popRank_(n, mode) : 999,
             a: (typeof nicksOf_ === 'function') ? nicksOf_(n) : [],
             ban: st ? { from: st.from, to: st.to, size: st.size, unit: st.unit, scope: st.scope } : null };
  }).filter(function(x){ return x.spots > 0; })
    // 사람들이 실제로 노리는 순서로 세운다.
    // 다만 금어기와 철 아닌 것은 아래로 내린다 — 눌러도 소용이 없기 때문이다.
    .sort(function(x, y){
      var xb = x.banned ? 1 : 0, yb = y.banned ? 1 : 0;
      if (xb !== yb) return xb - yb;
      var xo = x.season > 0 ? 0 : 1, yo = y.season > 0 ? 0 : 1;
      if (xo !== yo) return xo - yo;
      return (x.pop - y.pop) || (y.season - x.season) || (y.spots - x.spots);
    });
}

/* ── 레퍼럴 집계 ─────────────────────────────────────
 * 파트너 코드별 유입·전환을 스크립트 속성에 쌓는다.
 * 나중에 결제·예약이 붙으면 conv 이벤트에 금액을 실어 정산 근거가 된다. */
function trackRef_(code, ev, amount){
  try {
    var props = PropertiesService.getScriptProperties();
    var k = 'ref_' + code;
    var d; try { d = JSON.parse(props.getProperty(k) || '{}'); } catch(e){ d = {}; }
    var day = todayStr_();
    d.first = d.first || day;
    d.last = day;
    d[ev] = (d[ev] || 0) + 1;
    if (amount) d.amount = (d.amount || 0) + amount;
    props.setProperty(k, JSON.stringify(d));
  } catch(e){}
}
/** 화면에서 전환 이벤트를 보낸다 (상세 열람·길찾기 등) */
function apiRefEvent(code, ev){
  if (!code || !ev) return;
  code = String(code).replace(/[^\w-]/g,'').slice(0,24);
  if (['open','nav','share'].indexOf(ev) < 0) return;
  trackRef_(code, ev);
}
/** 주인용 — 파트너별 집계표 */
function refStats(){
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties(), out = [];
  for (var k in all){
    if (k.indexOf('ref_') !== 0) continue;
    var d; try { d = JSON.parse(all[k]); } catch(e){ continue; }
    d.code = k.slice(4);
    out.push(d);
  }
  out.sort(function(a,b){ return (b.visit||0) - (a.visit||0); });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function clearCache(){
  var c = CacheService.getScriptCache();
  c.removeAll((typeof pool_==='function' ? pool_() : POINTS).map(function(p){ return 'bt_' + p.i; }));
  Logger.log('캐시 삭제 완료');
}
