/**
 * 해루낚 — 자가 운영 루프
 *
 * 목표: 배포 후 주인이 손대지 않아도 데이터가 스스로 돌게 한다.
 *
 *   매시    warmLoop()    오늘·내일 보드를 미리 계산해 캐시를 항상 덥혀 둔다
 *   매일    calibLoop()   자동 승격 지점 중 오래된 것을 다시 역산한다
 *   매일    healthLoop()  바다타임·기상 소스 생존 확인. 죽으면 우회 깃발을 세우고,
 *                         상태가 바뀔 때만 주인에게 메일을 보낸다
 *   매주    auditLoop()   금어기 자료 나이·오류 로그를 점검해 할 일을 메일로 보낸다
 *
 * 설치: 앱스 스크립트 편집기에서 setupLoops 를 한 번 실행하면 끝.
 * 해제: teardownLoops 실행.
 */

var LOOP = {
  OWNER_EMAIL: 'thecloudstay@gmail.com',   // 상태 알림 수신처
  CALIB_MAX_AGE_DAYS: 30,                  // 자동 지점 재보정 주기
  CALIB_PER_RUN: 20,                       // 하루에 다시 재는 지점 수 (호출량 보호)
  BAN_STALE_DAYS: 330                      // 금어기 자료가 이보다 늙으면 갱신 독촉
};

/** 트리거 설치 — 한 번만 실행 */
function setupLoops(){
  teardownLoops();
  ScriptApp.newTrigger('warmLoop').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('calibLoop').timeBased().atHour(3).everyDays(1).create();
  ScriptApp.newTrigger('healthLoop').timeBased().atHour(4).everyDays(1).create();
  ScriptApp.newTrigger('auditLoop').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
  ScriptApp.newTrigger('moneyLoop').timeBased().onMonthDay(1).atHour(8).create();
  Logger.log('루프 5개 설치 완료 (매시 예열 / 새벽 3시 재보정 / 새벽 4시 점검 / 월요일 7시 감사)');
}
function teardownLoops(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (['warmLoop','calibLoop','healthLoop','auditLoop','moneyLoop'].indexOf(t.getHandlerFunction()) >= 0)
      ScriptApp.deleteTrigger(t);
  });
}

/* ── 매시: 캐시 예열 ─────────────────────────────────── */
function warmLoop(){
  var today = todayStr_();
  var tomorrow = Utilities.formatDate(new Date(Date.now() + 86400000), CFG.TZ, 'yyyy-MM-dd');
  ['haeru','fish'].forEach(function(m){
    try { apiBoard(today, m, {}); } catch(e){ loopLog_('warm', '오늘 ' + m + ' 실패: ' + e.message); }
  });
  // 내일 치는 홀수 시각에만 (호출량 절반)
  if (new Date().getHours() % 2 === 1){
    ['haeru','fish'].forEach(function(m){
      try { apiBoard(tomorrow, m, {}); } catch(e){}
    });
  }
}

/* ── 매일: 자동 지점 재보정 ──────────────────────────── */
function calibLoop(){
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var now = Date.now(), done = 0;
  for (var k in all){
    if (k.indexOf('pt_') !== 0 || done >= LOOP.CALIB_PER_RUN) continue;
    var p; try { p = JSON.parse(all[k]); } catch(e){ continue; }
    var age = (now - (p.calibAt || 0)) / 86400000;
    if (age < LOOP.CALIB_MAX_AGE_DAYS) continue;
    var cal = calibrate_(p.i, p.s, p.lo);
    if (cal){
      p.mr = cal.mr; p.hi = cal.hi; p.calibAt = now;
      p.tag = '자동 보정 지점 (' + cal.samples + '일치 물때에서 역산)';
      props.setProperty(k, JSON.stringify(p));
      done++;
    }
  }
  if (done) loopLog_('calib', done + '개 지점 재보정');
}

/* ── 매일: 소스 생존 점검 ───────────────────────────── */
function healthLoop(){
  var props = PropertiesService.getScriptProperties();
  var status = { bt: false, wx: false };

  // 바다타임 — 부산(1번)으로 파서까지 검증
  try {
    var bt = fetchBadatimeRaw_(1);
    status.bt = !!(bt && Object.keys(bt).length >= 8);
  } catch(e){}

  // 기상 — 서울 좌표 하나
  try {
    var wx = fetchWeather_([{la:37.5, lo:127.0}], todayStr_());
    var rec = wx[gridKey_(37.5, 127.0)];
    status.wx = !!(rec && rec.temp && rec.temp.length);
  } catch(e){}

  // 우회 깃발 — tideOf_ 가 이걸 보고 죽은 소스를 건너뛴다
  if (!status.bt) props.setProperty('BT_DOWN', String(Date.now()));
  else props.deleteProperty('BT_DOWN');

  // 상태가 바뀐 날만 메일
  var prev = props.getProperty('HEALTH') || '';
  var cur = (status.bt ? 'bt1' : 'bt0') + (status.wx ? 'wx1' : 'wx0');
  if (cur !== prev){
    props.setProperty('HEALTH', cur);
    var msg = '해루낚 데이터 소스 상태가 바뀌었습니다.\n\n' +
      '바다타임 물때: ' + (status.bt ? '정상' : '응답 없음 → 자체 조석 계산으로 우회 중') + '\n' +
      '기상(Open-Meteo): ' + (status.wx ? '정상' : '응답 없음 → 기상 없이 채점 중') + '\n\n' +
      '둘 다 죽어도 앱은 내장 계산으로 계속 돕니다. 파서 수리가 필요하면 Tide.gs 의 parseBadatime_ 을 보세요.';
    try { MailApp.sendEmail(LOOP.OWNER_EMAIL, '[해루낚] 소스 상태 변경', msg); } catch(e){}
  }
  loopLog_('health', cur);
}

/* ── 매주: 자료 나이 감사 ───────────────────────────── */
function auditLoop(){
  var props = PropertiesService.getScriptProperties();
  var msgs = [];

  // 금어기 안내 페이지 변경 감시 — 내용을 긁어 적용하지 않고, 바뀐 사실만 알린다
  try {
    var r = UrlFetchApp.fetch(BAN_META.nifs, { muteHttpExceptions: true });
    if (r.getResponseCode() === 200){
      var h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, r.getContentText()));
      var prev = props.getProperty('NIFS_HASH');
      if (prev && prev !== h)
        msgs.push('국립수산과학원 금어기 안내 페이지 내용이 바뀌었습니다. 확인 후 저장소 data/ban-extra.json 만 고치면 앱에 반영됩니다.\n' + BAN_META.nifs);
      props.setProperty('NIFS_HASH', h);
    }
  } catch(e){}
  var asOf = new Date(BAN_META.asOf);
  var ageDays = (Date.now() - asOf.getTime()) / 86400000;
  if (ageDays > LOOP.BAN_STALE_DAYS)
    msgs.push('금어기 자료가 ' + Math.round(ageDays) + '일 되었습니다. 국가법령정보센터에서 개정 여부를 확인하고 Ban.gs 를 갱신하세요.\n' + BAN_META.law);
  var log = props.getProperty('LOOP_LOG') || '';
  var errs = (log.match(/실패/g) || []).length;
  if (errs >= 5) msgs.push('최근 루프 오류가 ' + errs + '건 쌓였습니다. 로그:\n' + log.slice(-1500));
  if (msgs.length){
    try { MailApp.sendEmail(LOOP.OWNER_EMAIL, '[해루낚] 주간 점검', msgs.join('\n\n')); } catch(e){}
  }
}

/** 순환 로그 — 속성 하나에 최근 기록만 남긴다 */
function loopLog_(tag, msg){
  try {
    var props = PropertiesService.getScriptProperties();
    var log = props.getProperty('LOOP_LOG') || '';
    log += '\n' + Utilities.formatDate(new Date(), CFG.TZ, 'MM-dd HH:mm') + ' [' + tag + '] ' + msg;
    if (log.length > 6000) log = log.slice(-4000);
    props.setProperty('LOOP_LOG', log);
  } catch(e){}
}
