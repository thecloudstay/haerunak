/**
 * 해루낚 미리보기 빌더 v3 — 채점 엔진을 통째로 페이지에 심는다.
 * 미리 계산한 표가 아니라 실제 엔진이 브라우저 안에서 돌므로
 * 아무 지점·아무 날짜·아무 어종을 눌러도 전부 계산된다.
 * (기상만 가상값 — 실제 배포본은 Open-Meteo 실측)
 */
const fs=require('fs');
const DS=process.argv[2]||new Date(Date.now()+9*36e5).toISOString().slice(0,10);

// GAS 파일들을 브라우저용으로 이어붙인다
const ENGINE_FILES=['Points.gs','Index.gs','Tide.gs','Model.gs','Ban.gs','Remote.gs','Spots.gs','Weather.gs','Score.gs','Calib.gs','Log-stub.js','Money.gs','Rig.gs','Code.gs'];
let engine=ENGINE_FILES.map(f=>'/* ══ '+f+' ══ */\n'+fs.readFileSync(f,'utf8')).join('\n\n');
// 포인트 수 — 문구에 숫자를 박아두면 늘어날 때마다 거짓이 된다. Points.gs 에서 센다.
const NPTS=(fs.readFileSync('Points.gs','utf8').match(/\{\s*i:\s*\d+\s*,/g)||[]).length;
// 정적 페이지들이 읽는 통계 — 숫자를 문서에 박아두지 않기 위해 data/stats.json 으로 낸다
try {
  const _pts=fs.readFileSync('Points.gs','utf8');
  const _isl=(_pts.match(/\{\s*i:\s*\d+\s*,[^\n]*isl:\s*1/g)||[]).length;
  let _sp=0; try { _sp=JSON.parse(fs.readFileSync('atlas_data.json','utf8')).species.length; } catch(e){}
  fs.mkdirSync('ghup/data',{recursive:true});
  fs.writeFileSync('ghup/data/stats.json', JSON.stringify({points:NPTS, islands:_isl, species:_sp, updated:DS}));
} catch(e){ console.log('stats.json 실패', e.message); }

const SHIM =`
/* ══ 브라우저 셈 — 앱스 스크립트 전역 모의 ══ */
var __props={};
var PropertiesService={getScriptProperties:function(){return{
  getProperty:function(k){return __props[k]||null;},
  setProperty:function(k,v){__props[k]=v;},
  getProperties:function(){return __props;},
  deleteProperty:function(k){delete __props[k];}};}};
var CacheService={getScriptCache:function(){return{get:function(){return null;},getAll:function(){return{};},put:function(){},removeAll:function(){}};}};
var UrlFetchApp={fetch:function(){return{getResponseCode:function(){return 500;},getContentText:function(){return '';}};},fetchAll:function(){return [];}};
var HtmlService={createTemplateFromFile:function(){return{evaluate:function(){var o={setTitle:function(){return o;},addMetaTag:function(){return o;},setXFrameOptionsMode:function(){return o;}};return o;}};},createHtmlOutputFromFile:function(){return{getContent:function(){return '';}};},XFrameOptionsMode:{ALLOWALL:1}};
var Logger={log:function(){}};
var ScriptApp={newTrigger:function(){var o={timeBased:function(){return o;},everyHours:function(){return o;},atHour:function(){return o;},everyDays:function(){return o;},onWeekDay:function(){return o;},create:function(){}};return o;},getProjectTriggers:function(){return [];},WeekDay:{},deleteTrigger:function(){}};
var MailApp={sendEmail:function(){}};
var Utilities={formatDate:function(d,tz,f){var s=new Date(d.getTime()+9*36e5).toISOString();return f==='yyyy-MM-dd'?s.slice(0,10):s.slice(11,16);}};
`;

let OVERRIDE=`
/* ══ 기상 — 브라우저가 Open-Meteo 에서 직접 받아온다 (실패 시 예시값) ══ */
var WXC = {};                  // ds|셀 → 기상 레코드
var WX_REAL = {};              // ds → 실측 여부
function wxFor(p,ds){
  var seed=((p.i*2654435761)^(ds.charCodeAt(9)*7919+ds.charCodeAt(8)*131))%1000/1000;
  var sd=Math.abs(seed);
  var base={W:{wave:0.5,wind:5,sst:23},S:{wave:0.7,wind:6,sst:24.5},E:{wave:1.1,wind:8,sst:22},J:{wave:0.9,wind:7,sst:25}}[p.s]||{wave:0.6,wind:6,sst:23};
  var wave=Math.max(0.15,base.wave+(sd-0.5)*0.9), wind=Math.max(1,base.wind+(sd-0.5)*7);
  var A=function(v){return Array(24).fill(v);}, t=26-(p.la-33)*0.6;
  return {temp:A(t),feel:A(t-1),rain:A(sd>0.85?(sd-0.85)*20:0),cloud:A(Math.round(sd*100)),
          wind:A(wind),gust:A(wind*1.5),wdir:A(Math.round(sd*360)),pres:A(0).map(function(_,i){return 1013+(i-12)*((sd-0.5)*8)/12;}),
          wave:A(wave),wper:A(5),sst:A(base.sst+(sd-0.5)*3)};
}
fetchWeather_=function(points,ds){
  var out={};
  points.forEach(function(p){
    var k=gridKey_(p.la,p.lo);
    out[k]=WXC[ds+'|'+k]||wxFor(p,ds);
  });
  return out;
};
function ensureWeather(ds){
  /* 기상 예보 한계(7일) 밖 — 헛되이 부르지 않고 물때만으로 간다.
     '오늘' 기준은 엔진(BOOT.today, 한국시)과 반드시 같아야 한다. */
  try {
    var _b = (window.BOOT && BOOT.today) ? BOOT.today : (typeof todayStr_==='function' ? todayStr_() : null);
    if (_b){
      var _q = _b.split('-'), _t = new Date(+_q[0], +_q[1]-1, +_q[2]);
      var _p = ds.split('-'), _d = new Date(+_p[0], +_p[1]-1, +_p[2]);
      if (Math.round((_d - _t) / 86400000) > 6) return Promise.resolve('tideonly');
    }
  } catch(e){}
  if (WX_REAL[ds]!==undefined) return Promise.resolve(WX_REAL[ds]);
  // 이 기기 캐시(1시간)
  try {
    var c=JSON.parse(localStorage.getItem('hrn_wx_'+ds)||'null');
    if (c && Date.now()-c.t<3600000){ Object.assign(WXC,c.d); WX_REAL[ds]=true; return Promise.resolve(true); }
  } catch(e){}
  /* 1순위 — 우리 저장소에 미리 받아 둔 자료.
     사람이 몰려도 외부 한도에 걸리지 않는다. 세 시간마다 갱신된다. */
  return fetch('data/wx/'+ds+'.json', {cache:'default'})
    .then(function(r){ if(!r.ok) throw 0; return r.json(); })
    .then(function(j){
      if (!j || !j.자료) throw 0;
      var n=0;
      for (var k in j.자료){ WXC[ds+'|'+k]=j.자료[k]; n++; }
      if (!n) throw 0;
      WX_REAL[ds]=true;
      try { localStorage.setItem('hrn_wx_'+ds,JSON.stringify({t:Date.now(),d:(function(){var d={};for(var k2 in WXC){if(k2.indexOf(ds+'|')===0)d[k2]=WXC[k2];}return d;})()})); } catch(e){}
      return true;
    })
    .catch(function(){ return ensureWeatherLive_(ds); });
}
/* 2순위 — 미리 받아 둔 자료가 없으면 그때만 직접 부른다 */
function ensureWeatherLive_(ds){
  var cells={};
  POINTS.forEach(function(p){ var k=gridKey_(p.la,p.lo); if(!cells[k]) cells[k]={la:+k.split(',')[0],lo:+k.split(',')[1]}; });
  var keys=Object.keys(cells);
  var jobs=[];
  for (var s0=0;s0<keys.length;s0+=30){
    (function(chunk){
      var lats=chunk.map(function(k){return cells[k].la;}).join(',');
      var lons=chunk.map(function(k){return cells[k].lo;}).join(',');
      var land=fetch('https://api.open-meteo.com/v1/forecast?latitude='+lats+'&longitude='+lons
        +'&hourly=temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,visibility,snowfall,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,surface_pressure'
        +'&timezone=Asia%2FSeoul&start_date='+ds+'&end_date='+ds+'&wind_speed_unit=ms').then(function(r){return r.json();});
      var sea=fetch('https://marine-api.open-meteo.com/v1/marine?latitude='+lats+'&longitude='+lons
        +'&hourly=wave_height,wave_period,sea_surface_temperature'
        +'&timezone=Asia%2FSeoul&start_date='+ds+'&end_date='+ds).then(function(r){return r.json();}).catch(function(){return null;});
      jobs.push(Promise.all([land,sea]).then(function(res){
        var L0=res[0],S0=res[1];
        var La=Array.isArray(L0)?L0:[L0], Sa=S0?(Array.isArray(S0)?S0:[S0]):[];
        chunk.forEach(function(k,i){
          var L=La[i],S2=Sa[i];
          WXC[ds+'|'+k]={
            temp:L&&L.hourly?L.hourly.temperature_2m:null, feel:L&&L.hourly?L.hourly.apparent_temperature:null,
            rain:L&&L.hourly?L.hourly.precipitation:null, cloud:L&&L.hourly?L.hourly.cloud_cover:null,
            rainP:L&&L.hourly?L.hourly.precipitation_probability:null, code:L&&L.hourly?L.hourly.weather_code:null,
            vism:L&&L.hourly?L.hourly.visibility:null, snow:L&&L.hourly?L.hourly.snowfall:null,
            wind:L&&L.hourly?L.hourly.wind_speed_10m:null, gust:L&&L.hourly?L.hourly.wind_gusts_10m:null,
            wdir:L&&L.hourly?L.hourly.wind_direction_10m:null, pres:L&&L.hourly?L.hourly.surface_pressure:null,
            wave:S2&&S2.hourly?S2.hourly.wave_height:null, wper:S2&&S2.hourly?S2.hourly.wave_period:null,
            sst:S2&&S2.hourly?S2.hourly.sea_surface_temperature:null };
        });
      }));
    })(keys.slice(s0,s0+30));
  }
  return Promise.all(jobs).then(function(){
    WX_REAL[ds]=true;
    try { var d={}; for(var k in WXC){ if(k.indexOf(ds+'|')===0) d[k]=WXC[k]; }
          localStorage.setItem('hrn_wx_'+ds,JSON.stringify({t:Date.now(),d:d})); } catch(e){}
    return true;
  }).catch(function(){ WX_REAL[ds]=false; return false; });
}
todayStr_=function(){ var d=new Date(Date.now()+9*36e5); return d.toISOString().slice(0,10); };
fetchCoord_=function(){ return null; };
calibrate_=function(){ return null; };

/* ══ 공식 물때(국립해양조사원) 캐시 — 있으면 자체계산 대신 쓴다 ══
   data/tide-stations.json + data/tide/<ds>.json 을 받아, 지점에서 가장 가까운
   관측소(약 30km 안)의 공식 만조·간조로 갈아끼운다. 없으면 자체계산 그대로. */
var TIDE_ST = null, TIDE_CACHE = {}, TIDE_NEAR = {};
function tideKm_(a,b,c,d){ var r=Math.PI/180,x=(c-a)*r,y=(d-b)*r;
  var h=Math.sin(x/2)*Math.sin(x/2)+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)*Math.sin(y/2);
  return 2*6371*Math.asin(Math.sqrt(h)); }
function nearStation_(p){
  if (!TIDE_ST) return null;
  if (TIDE_NEAR[p.i] !== undefined) return TIDE_NEAR[p.i];
  var best=null, bd=1e9;
  TIDE_ST.forEach(function(st){ var d=tideKm_(p.la,p.lo,st.la,st.lo); if(d<bd){bd=d;best=st;} });
  var r = (best && bd <= 30) ? best.code : null;    // 30km 넘으면 그 관측소는 다른 물때다
  TIDE_NEAR[p.i]=r; return r;
}
function ensureTide(ds){
  if (ensureTide._d[ds]) return ensureTide._d[ds];
  ensureTide._d[ds] = (function(){
    var stP = TIDE_ST ? Promise.resolve() : fetch('data/tide-stations.json')
      .then(function(r){ return r.ok?r.json():null; })
      .then(function(j){ TIDE_ST = (j && j.stations) || []; }).catch(function(){ TIDE_ST=[]; });
    return stP.then(function(){
      return fetch('data/tide/'+ds+'.json', {cache:'default'})
        .then(function(r){ return r.ok?r.json():null; })
        .then(function(j){ if(j) TIDE_CACHE[ds]=j; }).catch(function(){});
    });
  })();
  return ensureTide._d[ds];
}
ensureTide._d = {};
var _calcTideOrig = calcTide_;
calcTide_ = function(p, y, mo, d){
  try {
    var ds = y + '-' + ('0'+mo).slice(-2) + '-' + ('0'+d).slice(-2);
    var cache = TIDE_CACHE[ds];
    if (cache){
      var code = nearStation_(p);
      if (code && cache[code] && cache[code].length){
        var ev = cache[code].map(function(e){ return {k:e.k,t:e.t,lv:e.lv}; });
        var lv = ev.map(function(x){return x.lv;});
        return { events: ev, range: (Math.max.apply(null,lv)-Math.min.apply(null,lv))/100, src:'khoa' };
      }
    }
  } catch(e){}
  return _calcTideOrig(p, y, mo, d);
};

/* ══ 실측 관측값 — data/obs.json (수집 작업이 세 시간마다 갱신) ══
   예보가 아니라 지금 실제 값이라, 저기압·강풍으로 예보가 어긋난 날을 잡아낸다. */
obsNear_ = function(p){
  var j = (typeof REMOTE !== 'undefined') ? REMOTE['obs'] : null;
  if (!j || !j.s || !TIDE_ST || !TIDE_ST.length) return null;
  var best = null, bd = 1e9;
  TIDE_ST.forEach(function(st){
    if (!j.s[st.code]) return;
    var d = tideKm_(p.la, p.lo, st.la, st.lo);
    if (d < bd){ bd = d; best = st; }
  });
  if (!best || bd > 60) return null;
  var v = j.s[best.code] || {}, wave = null;
  (j.wave || []).forEach(function(w){
    var d2 = tideKm_(p.la, p.lo, w.la, w.lo);
    if (d2 < 110 && (!wave || d2 < wave._d)) wave = { h:w.h, p:w.p, n:w.n, _d:d2 };
  });
  return { obs: best.name, km: Math.round(bd), at: j.at || v.at || null,
           lv: v.lv != null ? v.lv : null, tw: v.tw != null ? v.tw : null,
           ws: v.ws != null ? v.ws : null, wv: wave ? wave.h : null, wvn: wave ? wave.n : null };
};

/* ══ 조황 기록 — 이 기기 저장 (백엔드판은 시트 공동 저장) ══ */
function catchAll_(){ try { return JSON.parse(localStorage.getItem('hrn_catch')||'[]'); } catch(e){ return []; } }
apiCatchSave=function(e){
  var a=catchAll_();
  a.push({ds:e.ds,i:e.i,n:e.n,mode:e.mode,tg:String(e.targets||'').slice(0,60),rs:e.result,
          memo:String(e.memo||'').slice(0,120),nick:String(e.nick||'익명').slice(0,16),mul:e.mul,score:e.score});
  try { localStorage.setItem('hrn_catch',JSON.stringify(a.slice(-400))); } catch(err){}
  return {ok:true};
};
apiCatchPoint=function(id,mode){
  var W={상:1,중:0.62,하:0.3,꽝:0};
  var rows=catchAll_().filter(function(r){ return r.i===id && r.mode===mode; });
  if (!rows.length) return {n:0,recent:[],byMul:[]};
  var w=0,mul={};
  rows.forEach(function(r){ var v=W[r.rs]!==undefined?W[r.rs]:0.5; w+=v;
    var m=mul[r.mul||'?']||(mul[r.mul||'?']={n:0,w:0}); m.n++; m.w+=v; });
  var byMul=Object.keys(mul).map(function(k){ return {mul:k,n:mul[k].n,rate:Math.round(mul[k].w/mul[k].n*100)}; });
  byMul.sort(function(a,b){ return b.rate-a.rate; });
  return {n:rows.length,rate:Math.round(w/rows.length*100),
          recent:rows.slice(-8).reverse(),byMul:byMul.slice(0,5)};
};
apiRefEvent=function(){};
apiBizClick=function(){};
apiBookRequest=function(e){
  return {ok:false,msg:'예약 접수는 앱스 스크립트판에서 동작합니다. 업체 전화로 문의해주세요'};
};
apiRedeem=function(){ return {ok:false,msg:'이용권 등록은 앱스 스크립트판에서 동작합니다'}; };
apiRefLookup=function(){ return {ok:false,msg:'성과 조회는 앱스 스크립트판 주소에서 됩니다'}; };
apiSpotSuggest=function(e){
  try {
    var a=JSON.parse(localStorage.getItem('hrn_suggest')||'[]');
    a.push(e); localStorage.setItem('hrn_suggest',JSON.stringify(a.slice(-100)));
  } catch(err){}
  return {ok:true,local:true};
};
/* 원격 데이터 — 같은 저장소의 data/*.json 을 읽는다 (저장소만 고치면 즉시 반영) */
var REMOTE=__REMOTE_SEED__;
remoteJson_=function(name){ return REMOTE[name]||null; };
function ensureRemote(){
  if (ensureRemote._p) return ensureRemote._p;
  ensureRemote._p = Promise.all(['ban-extra','spots-extra','points-extra','partners','ads','gear','monetize','rigs','zones','protect','obs'].map(function(n){
    return fetch('data/'+n+'.json').then(function(r){ return r.ok?r.json():null; })
      .then(function(j){ if(j) REMOTE[n]=j; }).catch(function(){});
  }));
  return ensureRemote._p;
}
`;


// data/*.json 을 빌드 시점에 내장 — BOOT(지점 수·어종 목록)가 확장분을 즉시 반영한다
const _RM={};
// 지점 확장분만 내장한다. BOOT(지점 수·어종 목록)가 이걸 필요로 하기 때문이다.
// 나머지는 실행 중에 data/*.json 을 받아 쓴다 — 파일을 두 번 싣지 않기 위해서다.
['points-extra'].forEach(n=>{ try{ _RM[n]=JSON.parse(fs.readFileSync('ghup/data/'+n+'.json','utf8')); }catch(e){} });
OVERRIDE = OVERRIDE.replace('__REMOTE_SEED__', JSON.stringify(_RM));

// 조류 자동갱신(scripts/fetch-current.js)이 포인트마다 최강창낙조를 물어볼 수 있게 번호·좌표만 따로 내놓는다
try {
  const _pm = (fs.readFileSync('Points.gs','utf8').match(/\{\s*i:\s*(\d+)\s*,[^}]*?la:\s*([\d.]+)\s*,\s*lo:\s*([\d.]+)/g)||[])
    .map(s=>{ const m=s.match(/i:\s*(\d+)[^}]*?la:\s*([\d.]+)\s*,\s*lo:\s*([\d.]+)/); return {i:+m[1],la:+m[2],lo:+m[3]}; });
  fs.mkdirSync('ghup/data',{recursive:true});
  fs.writeFileSync('ghup/data/points-min.json', JSON.stringify(_pm));
} catch(e){ console.log('points-min.json 생략:', e.message); }

const RUNSHIM=`
/* ══ google.script.run 모의 — 페이지 안 엔진을 직접 부른다 ══ */
window.google={script:{run:{
  withSuccessHandler:function(f){var o=Object.create(this);o._s=f;return o;},
  withFailureHandler:function(f){var o=Object.create(this);o._f=f;return o;},
  _call:function(fn,args,ds){var s=this._s,f=this._f;
    var go=function(){
      try{ var r=fn.apply(null,args); s&&s(r); }
      catch(e){ console.error(e); f&&f({message:e.message}); }
    };
    if (ds){ Promise.all([ensureWeather(ds), ensureRemote(), ensureTide(ds)]).then(function(rs){ updateNote(rs[0]); setTimeout(go,40); }); }
    else setTimeout(go,100);},
  apiBoard:function(ds,mode,o){this._call(apiBoard,[ds,mode,o],ds);},
  apiPoint:function(id,ds,w){this._call(apiPoint,[id,ds,w,15],ds);},
  apiSpecies:function(ds,m){this._call(apiSpecies,[ds,m]);},
  apiSearch:function(q){this._call(apiSearch,[q]);},
  apiZones:function(){this._call(apiZones,[]);},
  apiCatchSave:function(e){this._call(apiCatchSave,[e]);},
  apiCatchPoint:function(i,m){this._call(apiCatchPoint,[i,m]);},
  apiRefEvent:function(){},
  clearCache:function(){var s=this._s;try{for(var k in localStorage){if(k.indexOf('hrn_wx_')===0)localStorage.removeItem(k);}}catch(e){}WX_REAL={};for(var k2 in WXC)delete WXC[k2];setTimeout(function(){s&&s();},60);}
}}};
`;

let idx=fs.readFileSync('Index.html','utf8');
idx=idx.replace('</head>', require('./analytics.js').analyticsTags()+'</head>');
idx=idx.replace("<?!= include('Style') ?>",fs.readFileSync('Style.html','utf8'));
idx=idx.replace("<?!= include('Script') ?>",fs.readFileSync('Script.html','utf8'));
idx=idx.replace(/<link rel="preconnect"[^>]*>\s*/,'');
idx=idx.replace(/<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net[^>]*>/,
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap">');
// 지도 판 스타일은 이제 저장소의 leaflet.css 를 직접 링크한다(Index.html). 옛날식 unpkg 링크가
// 남아 있을 때만 사본을 안에 박아 넣는다 — 없는 파일을 미리 읽다 죽지 않게 조건 안에서 읽는다.
if (/<link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet[^>]*>/.test(idx)){
  idx=idx.replace(/<link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet[^>]*>/,
    '<style>\n'+fs.readFileSync('ghup/leaflet.css','utf8')+'\n</style>');
}
// 지도 라이브러리는 통째로 넣지 않는다 — 방문자당 42KB(압축 후)를 아낀다.
// Index.html 이 CDN 두 곳을 거쳐 저장소 사본까지 3단으로 내려가게 짜여 있다.
// 다만 파일 하나로 도는 미리보기·아티팩트판은 사본을 옆에 둘 수 없으므로 통째로 넣는다.
if (process.env.HRN_INLINE_LEAFLET === '1'){
  idx=idx.replace(/<!--LEAFLET-->[\s\S]*?<!--\/LEAFLET-->/,
    '<script>\n'+fs.readFileSync('ghup/leaflet.js','utf8')+'\n</script>');
}
idx=idx.replace("'Pretendard Variable',Pretendard,","'Pretendard Variable',Pretendard,'Noto Sans KR',");

// 해안선 폴백 — 예전엔 64KB짜리 지형을 본문에 박아 넣고 늘 그렸다. 카카오 배경이 뜨면
// 곧바로 걷어내면서도 해석·그리기 값은 다 치렀다. 이제는 배경이 없을 때만 따로 받아 그린다.
idx=idx.replace('/* \u2500\u2500 \ubca0\uc774\uc2a4\ub9f5 \u2014 \ud0a4 \uc5c6\uc774',
`/* 0\uce35: \ub0b4\uc7a5 \ud574\uc548\uc120 \u2014 \ud0c0\uc77c\uc774 \uc548 \ub73c\ub294 \ud658\uacbd\uc5d0\uc11c\ub3c4 \uc9c0\ub3c4\uac00 \ube44\uc9c0 \uc54a\uac8c
   \uce74\uce74\uc624 \ubc30\uacbd\uc774 \uc548 \ub728\ub294 \ub54c\ub9cc \ubc1b\uc544 \uadf8\ub9b0\ub2e4 */
var COAST_LAYER = null, COAST_TRY = 0;
function coastLoad_(){
  if (COAST_LAYER || COAST_TRY) return;
  COAST_TRY = 1;
  fetch('coast.json').then(function(r){ return r.ok ? r.json() : null; }).then(function(g){
    if (!g) return;
    COAST_LAYER = L.geoJSON(g, {
      style: function(f){
        var kr = f.properties.n === 'South Korea';
        return { color: kr ? '#3d7a95' : '#24485c', weight: kr ? 1.1 : .8,
                 fillColor: kr ? '#12303f' : '#0c2230', fillOpacity: 1 };
      }, interactive: false, pane: 'tilePane'
    });
    if (!KAKAO.on) COAST_LAYER.addTo(map);
  }).catch(function(){});
}
/* \u2500\u2500 \ubca0\uc774\uc2a4\ub9f5 \u2014 \ud0a4 \uc5c6\uc774`);

// 정적판은 바다타임을 호출하지 않는다 (UrlFetchApp 껍데기가 막고 자체 계산으로 간다).
// 쓰지도 않는 곳을 출처로 적으면 표기가 거짓이 되므로 실제 근거로 바로잡는다.
idx = idx.split('\ubb3c\ub54c \ubc14\ub2e4\ud0c0\uc784 \u00b7 \uae30\uc0c1 Open-Meteo')
         .join('\ubb3c\ub54c \uc790\uccb4 \uc870\uc11d\uacc4\uc0b0 \u00b7 \uae30\uc0c1 Open-Meteo');

// 홈페이지 검색 메타 — 도감으로 들어온 사람이 홈으로 와도 무엇인지 알 수 있게
idx = idx.replace('</head>', [
  '<meta name="description" content="\ubb3c\ub54c \ud574\uc11d\uc740 \uc571\uc774 \ud569\ub2c8\ub2e4. \uc804\uad6d '+NPTS+'\uacf3\uc744 \uc870\uc11d\u00b7\uc218\uc911\uc2dc\uc57c\u00b7\uc870\ub958\u00b7\ubc14\ub78c\u00b7\uc218\uc628\u00b7\uae08\uc5b4\uae30\ub85c \ubd84\uc11d\ud574 \uc624\ub298 \uc5b4\ub514 \uac00\uc11c \ubb50\ub97c \uc7a1\uc744\uc9c0 \uacb0\ub860\ub9cc \uc54c\ub824\ub4dc\ub9bd\ub2c8\ub2e4.">',
  '<link rel="canonical" href="https://haerunak.com/">',
  '<meta property="og:type" content="website">',
  '<meta property="og:site_name" content="\ud574\ub8e8\ub09a">',
  '<meta property="og:title" content="\ud574\ub8e8\ub09a \u2014 \uc624\ub298 \uc5b4\ub514\uc11c \ubb50 \uc7a1\uc9c0">',
  '<meta property="og:description" content="\ubb3c\ub54c \ubcf4\uae30 \uc9dc\uc99d\ub098\ub294 \uc0ac\ub78c\uc744 \uc704\ud55c \uc571. \uc9c0\ub3c4\uc5d0\uc11c \uacb0\ub860\ub9cc \ubd05\ub2c8\ub2e4.">',
  '<meta property="og:url" content="https://haerunak.com/">',
  '<meta property="og:locale" content="ko_KR">',
  '<meta name="twitter:card" content="summary">',
  '</head>'
].join('\n'));

// 엔진 주입
const BOOT_STR=()=>{
  // BOOT 값은 엔진이 페이지 안에서 직접 만든다
  return `function updateNote(real){
  var n=document.querySelector('.demo-note');
  if (!n) return;
  // 정상일 때는 아무 말도 하지 않는다. 문제가 있을 때만 알린다.
  if (real === 'tideonly'){
    n.style.display = '';
    n.textContent = '이 날짜는 물때·진입/퇴로만 제공됩니다 — 정확한 점수는 7일 이내만';
    n.style.background = 'rgba(31,196,192,.1)';
    n.style.borderColor = 'rgba(31,196,192,.3)';
    n.style.color = '#a4e9d4';
    return;
  }
  if (real){ n.style.display = 'none'; return; }
  n.style.display = '';
  n.textContent = '기상 정보를 불러오지 못했습니다. 예시값으로 보여드리는 중입니다';
  n.style.background = 'rgba(255,176,138,.12)';
  n.style.borderColor = 'rgba(255,176,138,.32)';
  n.style.color = '#ffb08a';
}
window.BOOT = {today:todayStr_(),count:(typeof pool_==='function'?pool_().length:POINTS.length),indexCount:allIndex_().length,species:{haeru:allSpecies_('haeru'),fish:allSpecies_('fish')},ban:BAN_META,nonpro:NONPRO,ferry:(typeof ferryInfo_==='function'?ferryInfo_():null)};`;
};
idx=idx.replace(/<script>window\.BOOT = <\?!= BOOT \?>;<\/script>/,
  '<script>\n'+SHIM+'\n'+engine+'\n'+OVERRIDE+'\n'+RUNSHIM+'\n'+BOOT_STR()+'\n</script>');

// 미리보기 안내
idx=idx.replace('<button class="pick-cta" id="pickCta">',
`<div class="demo-note">기상 불러오는 중…</div>
    <button class="pick-cta" id="pickCta">`);
idx=idx.replace('</style>',
`.demo-note{margin-top:12px;padding:8px 12px;border-radius:11px;text-align:center;
  background:rgba(255,176,138,.12);border:1px solid rgba(255,176,138,.32);
  color:#ffb08a;font-size:10.5px;font-weight:600;line-height:1.45;pointer-events:none;}
</style>`);
idx=idx.replace('<base target="_top">',
  '<base target="_top">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n<meta name="theme-color" content="#05141f">\n<title>해루낚 — 오늘 어디서 뭘 잡지 | 전국 해루질·낚시 포인트 물때 추천</title>');

fs.writeFileSync('해루낚_미리보기.html',idx);
let art=idx.replace(/^[\s\S]*?<head>/,'').replace(/<\/head>\s*<body>/,'').replace(/<\/body>\s*<\/html>\s*$/,'');
art=art.replace(/<base target="_top">\s*/,'').replace(/<meta charset="utf-8">\s*/,'')
       .replace(/<meta name="viewport"[^>]*>\s*/,'').replace(/<meta name="theme-color"[^>]*>\s*/,'')
       .replace(/<title>[^<]*<\/title>\s*/,'');
art='<title>해루낚</title>\n'+art;
fs.writeFileSync('artifact.html',art);
console.log('완성 — 기준일',DS,'| 엔진 내장형');
console.log('단일 파일',(fs.statSync('해루낚_미리보기.html').size/1024).toFixed(0)+'KB / 아티팩트',(fs.statSync('artifact.html').size/1024).toFixed(0)+'KB');
