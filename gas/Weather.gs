/**
 * 해루낚 — 기상·해상 정보
 * Open-Meteo (인증키 불필요, 다지점 일괄 조회 지원)
 * 좌표를 0.4도 격자로 묶어 호출 수를 줄인다.
 */

var WX_CACHE_SEC = 3600;

function gridKey_(la, lo){
  return (Math.round(la/0.4)*0.4).toFixed(1) + ',' + (Math.round(lo/0.4)*0.4).toFixed(1);
}

/**
 * @param points [{la,lo}]
 * @param ds 'YYYY-MM-DD'
 * @return { '격자키': {hourly:{...}, daily:{...}} }
 */
function fetchWeather_(points, ds){
  var cache = CacheService.getScriptCache();
  var cells = {}, order = [];
  points.forEach(function(p){
    var k = gridKey_(p.la, p.lo);
    if (!cells[k]) { cells[k] = { la: +k.split(',')[0], lo: +k.split(',')[1] }; order.push(k); }
  });

  // 캐시 조회
  var need = [];
  var cached = cache.getAll(order.map(function(k){ return 'wx_' + ds + '_' + k; })) || {};
  var out = {};
  order.forEach(function(k){
    var c = cached['wx_' + ds + '_' + k];
    if (c) { try { out[k] = JSON.parse(c); return; } catch(e){} }
    need.push(k);
  });
  if (!need.length) return out;

  // 30개씩 묶어 일괄 조회
  for (var s = 0; s < need.length; s += 30){
    var chunk = need.slice(s, s + 30);
    var lats = chunk.map(function(k){ return cells[k].la; }).join(',');
    var lons = chunk.map(function(k){ return cells[k].lo; }).join(',');
    var land = null, sea = null;

    try {
      var r1 = UrlFetchApp.fetch('https://api.open-meteo.com/v1/forecast'
        + '?latitude=' + lats + '&longitude=' + lons
        + '&hourly=temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,visibility,snowfall,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,surface_pressure'
        + '&timezone=Asia%2FSeoul&start_date=' + ds + '&end_date=' + ds
        + '&wind_speed_unit=ms', { muteHttpExceptions: true });
      if (r1.getResponseCode() === 200) land = JSON.parse(r1.getContentText());
    } catch(e){}

    try {
      var r2 = UrlFetchApp.fetch('https://marine-api.open-meteo.com/v1/marine'
        + '?latitude=' + lats + '&longitude=' + lons
        + '&hourly=wave_height,wave_period,sea_surface_temperature'
        + '&timezone=Asia%2FSeoul&start_date=' + ds + '&end_date=' + ds, { muteHttpExceptions: true });
      if (r2.getResponseCode() === 200) sea = JSON.parse(r2.getContentText());
    } catch(e){}

    var landArr = land ? (Array.isArray(land) ? land : [land]) : [];
    var seaArr  = sea  ? (Array.isArray(sea)  ? sea  : [sea])  : [];

    chunk.forEach(function(k, idx){
      var L = landArr[idx], S = seaArr[idx];
      var rec = {
        temp:  L && L.hourly ? L.hourly.temperature_2m      : null,
        feel:  L && L.hourly ? L.hourly.apparent_temperature : null,
        rain:  L && L.hourly ? L.hourly.precipitation        : null,
        rainP: L && L.hourly ? L.hourly.precipitation_probability : null,
        code:  L && L.hourly ? L.hourly.weather_code         : null,
        vism:  L && L.hourly ? L.hourly.visibility           : null,
        snow:  L && L.hourly ? L.hourly.snowfall             : null,
        cloud: L && L.hourly ? L.hourly.cloud_cover          : null,
        wind:  L && L.hourly ? L.hourly.wind_speed_10m       : null,
        gust:  L && L.hourly ? L.hourly.wind_gusts_10m       : null,
        wdir:  L && L.hourly ? L.hourly.wind_direction_10m   : null,
        pres:  L && L.hourly ? L.hourly.surface_pressure     : null,
        wave:  S && S.hourly ? S.hourly.wave_height          : null,
        wper:  S && S.hourly ? S.hourly.wave_period          : null,
        sst:   S && S.hourly ? S.hourly.sea_surface_temperature : null
      };
      out[k] = rec;
      try { cache.put('wx_' + ds + '_' + k, JSON.stringify(rec), WX_CACHE_SEC); } catch(e){}
    });
  }
  return out;
}

/** 특정 시각(정수 시)의 값 뽑기 — 없으면 하루 평균 */
function wxAt_(rec, hour){
  if (!rec) return {};
  var h = Math.max(0, Math.min(23, Math.round(hour)));
  var g = function(arr){
    if (!arr || !arr.length) return null;
    var v = arr[h];
    if (v === null || v === undefined){
      var s = 0, c = 0;
      for (var k=0;k<arr.length;k++){ if (arr[k] !== null && arr[k] !== undefined){ s += arr[k]; c++; } }
      return c ? s/c : null;
    }
    return v;
  };
  /* 기상코드는 평균 내면 안 되는 범주값 — 해당 시각 값을 그대로 쓴다 */
  var pick = function(arr){
    if (!arr || !arr.length) return null;
    var v = arr[h];
    return (v === null || v === undefined) ? null : v;
  };
  var wind = g(rec.wind);
  var wave = g(rec.wave);
  // 파고 데이터가 없는 연안 격자는 풍속으로 추정
  if (wave === null && wind !== null) wave = Math.max(0.1, Math.pow(wind, 1.6) / 26);
  return {
    temp: g(rec.temp), feel: g(rec.feel), rain: g(rec.rain), cloud: g(rec.cloud),
    rainP: g(rec.rainP), code: pick(rec.code), vism: g(rec.vism), snow: g(rec.snow),
    wind: wind, gust: g(rec.gust), wdir: g(rec.wdir), pres: g(rec.pres),
    wave: wave, wper: g(rec.wper), sst: g(rec.sst)
  };
}

/** 하루 최대/합계 요약 */
function wxDay_(rec){
  if (!rec) return {};
  var mx = function(a){ if(!a||!a.length) return null; var m=-1e9; a.forEach(function(v){ if(v!=null&&v>m)m=v; }); return m===-1e9?null:m; };
  var sm = function(a){ if(!a||!a.length) return null; var s=0; a.forEach(function(v){ if(v!=null)s+=v; }); return s; };
  var worst = function(a){                        /* 가장 험한 기상코드 */
    if (!a || !a.length) return null;
    var m = -1;
    a.forEach(function(v){ if (v != null && SKY_RANK[v] !== undefined && SKY_RANK[v] > m) m = SKY_RANK[v]; });
    return m < 0 ? null : m;
  };
  var mn = function(a){ if(!a||!a.length) return null; var m=1e12; a.forEach(function(v){ if(v!=null&&v<m)m=v; }); return m===1e12?null:m; };
  return { rainSum: sm(rec.rain), windMax: mx(rec.wind), gustMax: mx(rec.gust), waveMax: mx(rec.wave),
           snowSum: sm(rec.snow), skyWorst: worst(rec.code), visMin: mn(rec.vism) };
}

var WDIR = ['북','북북동','북동','동북동','동','동남동','남동','남남동','남','남남서','남서','서남서','서','서북서','북서','북북서'];
function dirName_(deg){
  if (deg === null || deg === undefined) return '';
  return WDIR[Math.round(deg/22.5) % 16];
}
