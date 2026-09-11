/**
 * 해루낚 — 지점 자동 보정
 *
 * 정식 포인트가 아닌 지점(전체 색인 1,571곳)을 사용자가 고르면
 * 바다타임 월간 물때표에서 평균 조차와 고조간격을 역산하고
 * 지도 페이지에서 좌표를 받아 그 자리에서 분석 가능한 포인트로 만든다.
 * 결과는 스크립트 속성에 남겨 다음부터는 바로 쓴다.
 */

/** 지점명으로 바닥질을 추정한다 — 정확하진 않지만 없는 것보다 낫다 */
function guessFloor_(name){
  if (/방파제|항$|港|부두|등대|여|초$|암$|바위/.test(name)) return 'rock';
  if (/갯벌|포구|만$|천$|하구/.test(name)) return 'mud';
  if (/해변|해수욕장|사장|모래/.test(name)) return 'sand';
  if (/도$|섬/.test(name)) return 'mix';
  return 'mix';
}
/** 해역별 기본 고조간격 */
var HI_DEFAULT = { W:5.0, S:9.2, E:9.0, J:10.4 };

/**
 * 바다타임 월간표에서 지점 파라미터를 역산한다.
 * @return {mr, hi, samples} 또는 null
 */
function calibrate_(id, sea, lon){
  var bt = fetchBadatime_(id);
  if (!bt) return null;
  var days = Object.keys(bt).sort();
  if (days.length < 8) return null;

  var ranges = [], lags = [];
  for (var k = 0; k < days.length; k++){
    var rec = bt[days[k]];
    if (!rec || !rec.range) continue;
    ranges.push(rec.range);
    var a = days[k].split('-');
    var age = moonAge_(+a[0], +a[1], +a[2]);
    var mt  = moonTransit_(age, lon);
    var highs = (rec.events||[]).filter(function(e){ return e.k === 'H'; });
    for (var j = 0; j < highs.length; j++){
      var lag = ((highs[j].t - mt) % SEMI + SEMI) % SEMI;   // 달 남중 이후 만조까지
      lags.push(lag);
    }
  }
  if (!ranges.length) return null;

  // 평균 조차 — 모형의 sf 평균이 1 이므로 관측 평균이 곧 mr
  var mr = ranges.reduce(function(a,b){ return a+b; }, 0)/ranges.length / 0.94;

  // 고조간격 — 원형 평균으로 낸다 (12.42시간 주기라 단순 평균은 틀린다)
  var sx = 0, sy = 0;
  lags.forEach(function(L){
    var th = 2*Math.PI*L/SEMI;
    sx += Math.cos(th); sy += Math.sin(th);
  });
  var hi = HI_DEFAULT[sea] || 5;
  if (lags.length){
    var th2 = Math.atan2(sy, sx);
    hi = ((th2/(2*Math.PI)*SEMI) % SEMI + SEMI) % SEMI;
    // 해역 기본값과 반주기 어긋난 해를 고른다
    var alt = (hi + SEMI) % (2*SEMI);
    var base = HI_DEFAULT[sea] || 5;
    if (Math.abs(alt - base) < Math.abs(hi - base)) hi = alt;
  }
  return { mr: Math.round(mr*100)/100, hi: Math.round(hi*100)/100, samples: ranges.length };
}

/** 바다타임 지도 페이지에서 좌표를 긁는다 */
function fetchCoord_(id){
  try {
    var r = UrlFetchApp.fetch('https://m.badatime.com/m-' + id + '.html', {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' }
    });
    if (r.getResponseCode() !== 200) return null;
    var h = r.getContentText('UTF-8');
    // 위도 32~39, 경도 123~132 범위의 숫자 쌍을 찾는다
    var m = h.match(/(3[2-8]\.\d{3,8})\s*[,\s]\s*(1(?:2[3-9]|3[0-2])\.\d{3,8})/);
    if (m) return { la: +m[1], lo: +m[2] };
    m = h.match(/(1(?:2[3-9]|3[0-2])\.\d{3,8})\s*[,\s]\s*(3[2-8]\.\d{3,8})/);
    if (m) return { la: +m[2], lo: +m[1] };
    return null;
  } catch(e){ return null; }
}

/**
 * 색인 지점을 분석 가능한 포인트로 승격시킨다.
 * 좌표를 못 구하면 같은 해역 정식 포인트 중 이름이 가장 비슷한 곳의 좌표를 빌린다.
 */
function promote_(id){
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty('pt_' + id);
  if (saved){ try { return JSON.parse(saved); } catch(e){} }

  var idx = indexById_(id);
  if (!idx) return null;

  var co = fetchCoord_(id);
  if (!co){
    // 같은 해역의 정식 포인트 중 하나를 임시 좌표로 쓴다
    var near = null;
    for (var k = 0; k < POINTS.length; k++){
      if (POINTS[k].s === idx.s){ near = POINTS[k]; break; }
    }
    if (!near) return null;
    co = { la: near.la, lo: near.lo, approx: true };
  }
  var cal = calibrate_(id, idx.s, co.lo) || { mr: (idx.s === 'W' ? 4.5 : idx.s === 'S' ? 1.9 : idx.s === 'J' ? 1.5 : 0.2),
                                              hi: HI_DEFAULT[idx.s] || 5, samples: 0 };
  var p = {
    i: idx.i, n: idx.n, r: '', s: idx.s, la: co.la, lo: co.lo,
    mr: cal.mr, hi: cal.hi, f: guessFloor_(idx.n), kf: 2.0,
    tag: cal.samples > 0
      ? '자동 보정 지점 (' + cal.samples + '일치 물때에서 역산)'
      : '해역 평균값 사용 — 첫 정밀 조회 때 바다타임으로 자동 보정됩니다',
    auto: true, approxCoord: !!co.approx, calibAt: Date.now()
  };
  try { props.setProperty('pt_' + id, JSON.stringify(p)); } catch(e){}
  return p;
}

/** 정식 포인트를 먼저 찾고, 없으면 색인에서 승격시킨다 */
function anyPoint_(id){
  var p = pointById_(id);
  if (p) return p;
  if (typeof pool_ === 'function'){
    var pl = pool_();
    for (var k = 0; k < pl.length; k++) if (pl[k].i === id) return pl[k];
  }
  return promote_(id);
}

/** 저장해 둔 자동 보정 결과를 지운다 (개발용) */
function clearPromoted(){
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties(), n = 0;
  for (var k in all) if (k.indexOf('pt_') === 0){ props.deleteProperty(k); n++; }
  Logger.log('자동 보정 ' + n + '건 삭제');
}
