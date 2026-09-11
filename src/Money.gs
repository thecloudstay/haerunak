/**
 * 해루낚 — 수익화 계층
 *
 * 원칙 (수익모델 문서와 동일):
 *   · 안전 정보는 절대 유료화하지 않는다
 *   · 광고는 지역·시즌이 맞는 것만, 금어기 대상 광고는 자동 차단
 *   · 정산 근거는 파트너와 같은 화면으로 공유한다
 *
 * 데이터는 전부 저장소 JSON — 코드 수정 없이 영업이 굴러간다.
 *   data/partners.json  지점별 제휴처 (낚시점·숙박·식당·낚싯배)
 *   data/ads.json       광고 슬롯 (지역·월·모드·대상 타겟팅)
 *   data/gear.json      조건별 장비 추천 (제휴 링크)
 *   data/monetize.json  이용권 가격·결제 안내·정산 요율
 */

var MONEY = {
  REF_SHARE_BASE: 0.30,        // 레퍼럴 기본 분배율
  REF_SHARE_T1: 0.35,          // 월 신규 귀속 100명 이상
  REF_SHARE_T2: 0.40,          // 1,000명 이상
  BOOK_SHARE: 0.20,            // 예약 중개 수수료 중 파트너 몫
  PREMIUM_DAYS: 365            // 이용권 기간
};

/* ══════════ 제휴처 (지점별) ══════════ */
function apiPartners(pointId){
  var j = remoteJson_('partners');
  var list = (j && j.points && (j.points[String(pointId)] || j.points[pointId])) || [];
  // 노출 집계
  list.forEach(function(x){ if (x.id) bizCount_(x.id, 'imp'); });
  return list;
}

/* ══════════ 광고 슬롯 ══════════ */
/**
 * 조건에 맞는 광고 하나를 고른다. 없으면 null — 빈 슬롯은 그냥 비워둔다.
 * 금어기 필터: 광고의 대상물(sp)이 그날 그 지역 금어기면 절대 내보내지 않는다.
 */
function pickAd_(region, ds, mode, bannedNames){
  var j = remoteJson_('ads');
  var ads = (j && j.ads) || [];
  if (!ads.length) return null;
  var a = ds.split('-'), mo = +a[1], d = +a[2];
  var pool = ads.filter(function(ad){
    if (ad.off) return false;
    if (ad.rg && region.indexOf(ad.rg) < 0) return false;
    if (ad.months && ad.months.indexOf(mo) < 0) return false;
    if (ad.mode && ad.mode !== mode) return false;
    if (ad.sp){
      if ((bannedNames || []).indexOf(ad.sp) >= 0) return false;       // 화면상 금어기 목록
      var st = banStatus_(ad.sp, mo, d, region);                        // 규정 직접 재확인
      if (st && st.banned) return false;
    }
    return true;
  });
  if (!pool.length) return null;
  // 일자별 순환 — 같은 날은 같은 광고 (캐시 일관성)
  var pick = pool[(mo * 31 + d) % pool.length];
  if (pick.id) bizCount_(pick.id, 'imp');
  return { id: pick.id || '', t: pick.t || '', d: pick.d || '', url: pick.url || '', tag: '제휴' };
}

/* ══════════ 장비 추천 (조건 연동) ══════════ */
/**
 * 그날 조건이 만들어내는 실제 필요에만 장비를 붙인다 — 광고가 아니라 이어지는 말이 되도록.
 * gear.json 의 키: visLow(시야 나쁨) night(야간) mud(펄) rock(갯바위) cold(추움) rain(비)
 */
function gearFor_(meta, mode, floor){
  var j = remoteJson_('gear');
  if (!j) return [];
  var keys = [];
  if (mode === 'haeru'){
    if (meta.vis !== undefined && meta.vis < 0.9) keys.push('visLow');
    if (meta.moonLux !== undefined && meta.moonLux < 0.05) keys.push('night');
    if (floor === 'mud') keys.push('mud');
    if (floor === 'rock') keys.push('rock');
  }
  if (meta.wx && meta.wx.temp !== null && meta.wx.temp !== undefined && meta.wx.temp <= 8) keys.push('cold');
  if (meta.wx && meta.wx.rain !== null && meta.wx.rain >= 1) keys.push('rain');
  var out = [], seen = {};
  keys.forEach(function(k){
    (j[k] || []).forEach(function(g){
      if (seen[g.n] || out.length >= 4) return;
      seen[g.n] = 1;
      out.push({ n: g.n, url: g.url || '', why: g.why || '', id: g.id || '' });
    });
  });
  return out;
}

/* ══════════ 클릭·노출 집계 ══════════ */
function bizCount_(id, ev){
  try {
    var props = PropertiesService.getScriptProperties();
    var k = 'biz_' + String(id).replace(/[^\w-]/g,'').slice(0,24);
    var d; try { d = JSON.parse(props.getProperty(k) || '{}'); } catch(e){ d = {}; }
    d[ev] = (d[ev] || 0) + 1;
    props.setProperty(k, JSON.stringify(d));
  } catch(e){}
}
function apiBizClick(id, kind){
  if (!id) return;
  if (['partner','ad','gear','boat'].indexOf(kind) < 0) return;
  bizCount_(id, 'click');
  bizCount_(id, kind);
}

/* ══════════ 선박 예약 문의 (중개 1단계) ══════════ */
function bookSheet_(){
  var sh = logSheet_().getParent().getSheetByName('예약문의');
  if (!sh){
    sh = logSheet_().getParent().insertSheet('예약문의');
    sh.appendRow(['접수시각','출조일','지점','업체','인원','연락처','요청사항','레퍼럴','사용자','상태']);
  }
  return sh;
}
function apiBookRequest(e){
  if (!e || !e.partner || !e.tel) return { ok: false, msg: '업체와 연락처가 필요합니다' };
  bookSheet_().appendRow([
    Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm'),
    clean_(e.ds, 10), clean_(e.point, 30), clean_(e.partner, 40),
    clean_(e.pax, 6), clean_(e.tel, 20), clean_(e.memo, 140),
    clean_(e.ref, 24), clean_(e.uid, 24), '접수'
  ]);
  bizCount_(e.pid || e.partner, 'boat');
  try {
    MailApp.sendEmail(LOOP.OWNER_EMAIL, '[해루낚] 예약 문의 — ' + e.partner,
      '출조일 ' + e.ds + ' / ' + e.point + ' / ' + e.pax + '명\n연락처 ' + e.tel + '\n' + (e.memo || ''));
  } catch(err){}
  return { ok: true };
}

/* ══════════ 이용권 (프리미엄) ══════════ */
/**
 * 결제 연동 전의 정직한 1단계: 주인이 시트 「이용권」에 코드를 만들어 팔고,
 * 사용자가 코드를 넣으면 1년 열린다. 안전 정보는 무료 그대로,
 * 프리미엄은 15일 전망·광고 없음 같은 "깊이"만 연다.
 */
function passSheet_(){
  var sh = logSheet_().getParent().getSheetByName('이용권');
  if (!sh){
    sh = logSheet_().getParent().insertSheet('이용권');
    sh.appendRow(['코드','상태(판매전/판매됨/사용됨)','사용자','등록일','만료일','메모']);
  }
  return sh;
}
function apiRedeem(code, uid){
  code = clean_(code, 24).toUpperCase();
  if (!code) return { ok: false, msg: '코드를 입력하세요' };
  var sh = passSheet_(), last = sh.getLastRow();
  if (last < 2) return { ok: false, msg: '유효하지 않은 코드입니다' };
  var rows = sh.getRange(2, 1, last - 1, 6).getValues();
  for (var k = 0; k < rows.length; k++){
    if (String(rows[k][0]).toUpperCase() !== code) continue;
    if (String(rows[k][1]) === '사용됨') return { ok: false, msg: '이미 사용된 코드입니다' };
    var until = new Date(Date.now() + MONEY.PREMIUM_DAYS * 86400000);
    sh.getRange(k + 2, 2, 1, 4).setValues([[
      '사용됨', clean_(uid, 24),
      Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'),
      Utilities.formatDate(until, CFG.TZ, 'yyyy-MM-dd')
    ]]);
    return { ok: true, until: until.getTime() };
  }
  return { ok: false, msg: '유효하지 않은 코드입니다' };
}
function apiMonetizeInfo(){
  var j = remoteJson_('monetize') || {};
  return { price: j.price || '', payUrl: j.payUrl || '', payDesc: j.payDesc || '',
           contact: 'thecloudstay@gmail.com' };
}

/* ══════════ 월간 정산 ══════════ */
/** 매월 1일 아침 — 레퍼럴·제휴 성과를 시트에 쓰고 메일로 보낸다 */
function moneyLoop(){
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var lines = [], sheetRows = [];
  var month = Utilities.formatDate(new Date(Date.now() - 86400000 * 2), CFG.TZ, 'yyyy-MM');

  // 레퍼럴 — 분배율 자동 산정
  for (var k in all){
    if (k.indexOf('ref_') !== 0) continue;
    var d; try { d = JSON.parse(all[k]); } catch(e){ continue; }
    var code = k.slice(4);
    var visits = d.visit || 0, convs = (d.open || 0) + (d.nav || 0);
    var amount = d.amount || 0;
    var rate = visits >= 1000 ? MONEY.REF_SHARE_T2 : visits >= 100 ? MONEY.REF_SHARE_T1 : MONEY.REF_SHARE_BASE;
    var share = Math.round(amount * rate);
    lines.push('· ' + code + ' — 유입 ' + visits + ' / 전환 ' + convs +
               (amount ? ' / 매출 ' + amount + '원 → 분배 ' + share + '원 (' + Math.round(rate*100) + '%)' : ' / 매출 없음'));
    sheetRows.push([month, '레퍼럴', code, visits, convs, amount, Math.round(rate*100) + '%', share]);
    // 다음 달을 위해 방문 수는 리셋, 누적 금액은 정산했으면 0으로
    d.visit = 0; d.open = 0; d.nav = 0; if (amount) d.amount = 0;
    props.setProperty(k, JSON.stringify(d));
  }
  // 제휴·광고 성과
  for (var k2 in all){
    if (k2.indexOf('biz_') !== 0) continue;
    var b; try { b = JSON.parse(all[k2]); } catch(e){ continue; }
    lines.push('· 제휴 ' + k2.slice(4) + ' — 노출 ' + (b.imp||0) + ' / 클릭 ' + (b.click||0) +
               (b.boat ? ' / 예약문의 ' + b.boat : ''));
    sheetRows.push([month, '제휴', k2.slice(4), b.imp||0, b.click||0, '', '', '']);
    props.setProperty(k2, '{}');
  }

  if (sheetRows.length){
    try {
      var sh = logSheet_().getParent().getSheetByName('정산') ||
               logSheet_().getParent().insertSheet('정산');
      if (sh.getLastRow() === 0)
        sh.appendRow(['월','구분','코드/업체','유입·노출','전환·클릭','매출','요율','분배액']);
      sheetRows.forEach(function(r){ sh.appendRow(r); });
    } catch(e){}
    try {
      MailApp.sendEmail(LOOP.OWNER_EMAIL, '[해루낚] ' + month + ' 월간 정산',
        '이번 달 성과입니다. 시트 「정산」 탭에도 기록했습니다.\n\n' + lines.join('\n') +
        '\n\n분배율: 기본 30% / 월 유입 100명↑ 35% / 1,000명↑ 40% / 예약 수수료의 20%');
    } catch(e){}
  }
}

/** 파트너가 자기 코드로 성과를 직접 확인한다 — 정산 투명성의 실체 */
function apiRefLookup(code){
  code = String(code || '').replace(/[^\w-]/g,'').slice(0,24);
  if (!code) return { ok: false };
  var props = PropertiesService.getScriptProperties();
  var d; try { d = JSON.parse(props.getProperty('ref_' + code) || 'null'); } catch(e){ d = null; }
  if (!d) return { ok: false, msg: '아직 집계가 없는 코드입니다. 링크가 한 번이라도 열리면 생깁니다.' };
  var visits = d.visit || 0;
  var rate = visits >= 1000 ? MONEY.REF_SHARE_T2 : visits >= 100 ? MONEY.REF_SHARE_T1 : MONEY.REF_SHARE_BASE;
  return { ok: true, code: code, visit: visits, open: d.open || 0, nav: d.nav || 0,
           amount: d.amount || 0, rate: Math.round(rate * 100), first: d.first || '', last: d.last || '' };
}

/* ══════════ 준비물 제휴 링크 ══════════
 * 도구 이름을 상품군으로 정규화한 뒤 data/gear.json 의 shop 에서 링크를 찾는다.
 * 링크가 없으면 null 을 돌려주고 화면은 글자만 보여준다 — 빈 링크를 누르게 두지 않는다. */
function shopFor_(names){
  var j = remoteJson_('gear') || {};
  var shop = j.shop || {};
  var out = [], idx = {};
  (names || []).forEach(function(n){
    var k = (typeof gearKey_ === 'function') ? gearKey_(n) : n;
    if (!k) return;
    if (idx[k] === undefined){
      var s = shop[k];
      idx[k] = out.length;
      // src 에 원본 도구 이름을 모아둔다 — 화면에서 '긴 장화' 같은 변형도 링크를 찾게
      out.push({ n: k, u: (s && s.u) ? s.u : '', why: (s && s.why) ? s.why : '', src: [] });
    }
    if (out[idx[k]].src.indexOf(n) < 0) out[idx[k]].src.push(n);
  });
  return out;
}

/** 제휴 링크가 하나라도 걸려 있으면 고지 문구를 돌려준다.
 *  대가를 받는 사실을 알리는 것은 공정거래위원회 추천·보증 심사지침상 의무다. */
function shopDisclosure_(items){
  var has = (items || []).some(function(x){ return x && x.u; });
  if (!has) return '';
  var j = remoteJson_('gear') || {};
  return j.disclosure || '이 링크로 구매하시면 해루낚이 수수료를 받습니다. 가격은 같습니다.';
}

/* ══════════ 대상물별 '잡는 법' 영상 ══════════
 * 유튜버에게 노출 자리를 주는 것이 곧 대가다. 현금 없이 제휴가 성립한다.
 * 등록된 영상이 없으면 유튜브 검색 링크를 만든다 — 이건 언제나 유효하다. */
/** 오늘의 원픽에 걸 영상 하나.
 *  이 자리가 유튜버에게 주는 대가다 — 앱에서 가장 눈에 띄는 곳이다.
 *  지점 전용 영상이 1순위, 없으면 그날 대상물 영상, 그것도 없으면 걸지 않는다.
 *  (원픽에는 검색 링크를 걸지 않는다 — 빈손인 자리를 광고 자리처럼 보이게 하지 않는다) */
function pickVideo_(pointId, pointName, names, mode){
  var j = remoteJson_('videos') || {};
  var all = j.items || [];
  var mk = function(v){
    return { id:v.id||'', ch:v.ch||'', t:v.t||'', paid:!!v.paid, target:v.target||pointName,
             u: v.id ? ('https://www.youtube.com/watch?v=' + v.id) : (v.u || ''),
             thumb: v.id ? ('https://img.youtube.com/vi/' + v.id + '/mqdefault.jpg') : '' };
  };
  // 1순위 — 이 지점 전용
  var spot = all.filter(function(v){
    return v && (String(v.spot) === String(pointId) || v.spot === pointName);
  });
  spot.sort(function(a,b){ return (b.paid?1:0) - (a.paid?1:0); });
  if (spot.length) return mk(spot[0]);

  // 2순위 — 그날 대상물
  for (var i = 0; i < (names || []).length; i++){
    var hit = all.filter(function(v){ return v && v.target === names[i]; });
    hit.sort(function(a,b){ return (b.paid?1:0) - (a.paid?1:0); });
    if (hit.length) return mk(hit[0]);
  }
  return null;
}

function videosFor_(names, mode){
  var j = remoteJson_('videos') || {};
  var all = j.items || [];
  var out = [];
  (names || []).slice(0, 4).forEach(function(n){
    var hit = all.filter(function(v){ return v && v.target === n; });
    // 대가를 받은 노출을 위로 올린다
    hit.sort(function(a, b){ return (b.paid ? 1 : 0) - (a.paid ? 1 : 0); });
    if (hit.length){
      var v = hit[0];
      out.push({ target:n, id:v.id || '', ch:v.ch || '', t:v.t || '', paid:!!v.paid,
                 u: v.id ? ('https://www.youtube.com/watch?v=' + v.id) : (v.u || ''),
                 thumb: v.id ? ('https://img.youtube.com/vi/' + v.id + '/mqdefault.jpg') : '' });
    } else {
      var q = n + ' ' + (mode === 'fish' ? '낚시' : '잡는법');
      out.push({ target:n, id:'', ch:'', t:'', paid:false, search:true,
                 u: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q), thumb:'' });
    }
  });
  return out;
}
