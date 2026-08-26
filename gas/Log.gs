/**
 * 해루낚 — 조황 기록 (데이터 해자)
 *
 * 사용자가 "실제로 잡았는지"를 남기면:
 *   1) 그 지점 상세에 최근 기록과 물때별 성공률이 쌓인다
 *   2) 기록이 3건 이상 모인 지점은 예측 점수를 실측으로 미세 보정한다 (±4점)
 *
 * 저장소: 구글 스프레드시트. 첫 기록 때 주인 드라이브에
 * 「해루낚 조황기록」 시트가 자동 생성된다. 손댈 것 없음.
 */

var LOGBOOK = {
  MAX_READ: 1200,      // 집계에 읽는 최근 행 수
  CACHE_SEC: 900,      // 집계 캐시 15분
  BOOST_MIN_N: 3,      // 보정을 시작하는 최소 기록 수
  BOOST_MAX: 4         // 점수 보정 한도 (±)
};

function logSheet_(){
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('LOG_SHEET_ID');
  var ss = null;
  if (id){ try { ss = SpreadsheetApp.openById(id); } catch(e){} }
  if (!ss){
    ss = SpreadsheetApp.create('해루낚 조황기록');
    props.setProperty('LOG_SHEET_ID', ss.getId());
  }
  var sh = ss.getSheetByName('기록');
  if (!sh){
    sh = ss.getSheets()[0];
    sh.setName('기록');
    sh.appendRow(['기록시각','출조일','지점번호','지점명','모드','대상','조과','메모','닉네임','물때','당시점수','사용자']);
  }
  return sh;
}

function clean_(v, max){
  return String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, max || 60);
}

/**
 * 기록 저장.
 * e = { ds, i, n, mode, targets, result('상'|'중'|'하'|'꽝'), memo, nick, mul, score, uid }
 */
function apiCatchSave(e){
  if (!e || !e.i || !e.ds) return { ok: false, msg: '지점과 날짜가 필요합니다' };
  var result = ['상','중','하','꽝'].indexOf(e.result) >= 0 ? e.result : '중';
  var sh = logSheet_();
  sh.appendRow([
    Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm'),
    clean_(e.ds, 10), Number(e.i) || 0, clean_(e.n, 30),
    e.mode === 'fish' ? 'fish' : 'haeru',
    clean_(e.targets, 60), result, clean_(e.memo, 120), clean_(e.nick, 16) || '익명',
    clean_(e.mul, 8), Number(e.score) || '', clean_(e.uid, 24)
  ]);
  try { CacheService.getScriptCache().remove('catch_agg'); } catch(err){}
  return { ok: true };
}

/** 전 지점 집계 — 캐시 15분 */
function catchAgg_(){
  var cache = CacheService.getScriptCache();
  var hit = cache.get('catch_agg');
  if (hit){ try { return JSON.parse(hit); } catch(e){} }

  var agg = { points: {}, total: 0 };
  try {
    var sh = logSheet_();
    var last = sh.getLastRow();
    if (last >= 2){
      var from = Math.max(2, last - LOGBOOK.MAX_READ + 1);
      var rows = sh.getRange(from, 1, last - from + 1, 12).getValues();
      var W = { '상': 1, '중': 0.62, '하': 0.3, '꽝': 0 };
      rows.forEach(function(r){
        var pid = Number(r[2]); if (!pid) return;
        var mode = r[4] === 'fish' ? 'fish' : 'haeru';
        var key = pid + '|' + mode;
        var p = agg.points[key] || (agg.points[key] = { n: 0, w: 0, mul: {}, recent: [] });
        p.n++; p.w += (W[r[6]] !== undefined ? W[r[6]] : 0.5);
        var mk = String(r[9] || '?');
        var m = p.mul[mk] || (p.mul[mk] = { n: 0, w: 0 });
        m.n++; m.w += (W[r[6]] !== undefined ? W[r[6]] : 0.5);
        if (p.recent.length < 8)
          p.recent.push({ ds: String(r[1]), tg: String(r[5]), rs: String(r[6]),
                          memo: String(r[7]), nick: String(r[8]), mul: mk });
        agg.total++;
      });
      // 최근이 위로 오게 — 시트는 아래로 쌓이므로 뒤집는다
      for (var k in agg.points) agg.points[k].recent.reverse();
    }
  } catch(e){}
  try { cache.put('catch_agg', JSON.stringify(agg), LOGBOOK.CACHE_SEC); } catch(e){}
  return agg;
}

/** 지점 하나의 조황 요약 */
function apiCatchPoint(id, mode){
  var agg = catchAgg_();
  var p = agg.points[id + '|' + (mode === 'fish' ? 'fish' : 'haeru')];
  if (!p) return { n: 0, recent: [], byMul: [] };
  var byMul = [];
  for (var mk in p.mul){
    var m = p.mul[mk];
    byMul.push({ mul: mk, n: m.n, rate: Math.round(m.w / m.n * 100) });
  }
  byMul.sort(function(a,b){ return b.rate - a.rate; });
  return { n: p.n, rate: Math.round(p.w / p.n * 100), recent: p.recent, byMul: byMul.slice(0, 5) };
}

/** 실측 보정 지도 — apiBoard 가 쓴다. { '지점|모드': ±점수 } */
function catchBoostMap_(){
  var agg = catchAgg_(), out = {};
  for (var key in agg.points){
    var p = agg.points[key];
    if (p.n < LOGBOOK.BOOST_MIN_N) continue;
    var avg = p.w / p.n;                                   // 0~1
    var boost = Math.round((avg - 0.5) * 2 * LOGBOOK.BOOST_MAX);
    if (boost !== 0) out[key] = Math.max(-LOGBOOK.BOOST_MAX, Math.min(LOGBOOK.BOOST_MAX, boost));
  }
  return out;
}


/* ══════════ 세부 포인트 제보 ══════════
 * 사용자가 "여기 이런 자리가 있다"고 제보하면 시트 「제보」 탭에 쌓인다.
 * 주인이 상태 칸을 「승인」으로 바꾸면 1시간 안에 모든 사용자 화면에 뜬다.
 * 코드 수정·재배포가 필요 없다. */
function suggestSheet_(){
  var sh = logSheet_().getParent().getSheetByName('제보');
  if (!sh){
    sh = logSheet_().getParent().insertSheet('제보');
    sh.appendRow(['제보시각','지점번호','지점명','포인트명','설명','주의','대상','닉네임','사용자','상태(승인이라고 쓰면 반영)']);
  }
  return sh;
}
function apiSpotSuggest(e){
  if (!e || !e.i || !e.spot) return { ok: false, msg: '포인트 이름이 필요합니다' };
  suggestSheet_().appendRow([
    Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm'),
    Number(e.i) || 0, clean_(e.n, 30), clean_(e.spot, 40),
    clean_(e.desc, 140), clean_(e.warn, 100), clean_(e.targets, 60),
    clean_(e.nick, 16) || '익명', clean_(e.uid, 24), '검토중'
  ]);
  try { CacheService.getScriptCache().remove('spot_sug'); } catch(err){}
  return { ok: true };
}
/** 승인된 제보 — spotsOf_ 가 병합한다 */
function spotSuggests_(id){
  var cache = CacheService.getScriptCache();
  var all = null, hit = cache.get('spot_sug');
  if (hit){ try { all = JSON.parse(hit); } catch(e){} }
  if (!all){
    all = {};
    try {
      var sh = suggestSheet_();
      var last = sh.getLastRow();
      if (last >= 2){
        sh.getRange(2, 1, last - 1, 10).getValues().forEach(function(r){
          if (String(r[9]).trim() !== '승인') return;
          var pid = Number(r[1]); if (!pid) return;
          (all[pid] = all[pid] || []).push({
            n: String(r[3]), d: String(r[4]) + ' (이용자 제보: ' + String(r[7]) + ')',
            w: String(r[5]), t: String(r[6]) ? String(r[6]).split(/[,·\s]+/).filter(Boolean).slice(0,4) : []
          });
        });
      }
    } catch(e){}
    try { cache.put('spot_sug', JSON.stringify(all), 3600); } catch(e){}
  }
  return all[id] || [];
}
