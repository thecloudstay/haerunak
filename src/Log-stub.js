/* 정적판 대용 — 시트 기반 기능은 앱스 스크립트판에서만 동작 */
function logSheet_(){ throw new Error('static'); }
function clean_(v,max){ return String(v==null?'':v).replace(/[<>]/g,'').trim().slice(0,max||60); }
var LOOP = { OWNER_EMAIL: 'thecloudstay@gmail.com' };
