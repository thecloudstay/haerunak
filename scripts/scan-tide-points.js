/**
 * 해루낚 — 국립해양조사원 조석예보 「예보지점」 목록을 찾아 둔다.
 *
 * 왜: 지금까지는 조위관측소 27곳(DT_xxxx)만 썼다. 그런데 같은 API가 예보지점(SO_xxxx)도 준다.
 *     예보지점은 외포·동막처럼 바닷가 마을 단위라, 이걸 쓰면 바다타임과 같은 값이 나온다.
 *     예보지점 목록을 주는 통로가 없어서 번호를 차례로 두드려 있는 것만 적어 둔다.
 *
 * 어떻게: SO_0001~SO_1500, DT_0001~DT_0120 을 한 번씩 물어본다. 응답이 있으면 이름·좌표를 적는다.
 *         하루 호출 한도가 있으니 한 번에 BUDGET 개까지만 하고, 어디까지 했는지 적어 두었다가 다음에 이어 한다.
 *         다 훑고 나면 그다음부터는 바로 끝난다(아무 것도 안 부른다).
 *
 * 출력: data/tide-points.json = { done:bool, next:{SO:n, DT:n}, points:[{code,name,la,lo}] }
 *       사용한 호출 수를 /tmp/tide_calls_used 에 적는다(같은 작업에서 fetch-tide 가 남은 예산을 알 수 있게).
 */
const fs = require('fs');
const KEY = process.env.DATA_GO_KEY || '';
const BUDGET = +(process.env.SCAN_BUDGET || 500);
const BASE = 'https://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService';
const RANGE = { SO: 1500, DT: 120 };
const FILE = 'data/tide-points.json';
if (!KEY){ console.log('DATA_GO_KEY 없음 — 건너뜀'); process.exit(0); }

let st = { done:false, next:{SO:1, DT:1}, points:[] };
try { st = Object.assign(st, JSON.parse(fs.readFileSync(FILE,'utf8'))); } catch(e){}
if (st.done){ console.log('예보지점 목록 이미 완료 —', st.points.length, '곳'); fs.writeFileSync('/tmp/tide_calls_used','0'); process.exit(0); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
function ds(){ return new Date(Date.now()+9*3600e3).toISOString().slice(0,10).replace(/-/g,''); }
async function probe(code){
  const url = BASE + '?serviceKey=' + encodeURIComponent(KEY) + '&obsCode=' + code + '&reqDate=' + ds() + '&type=json&numOfRows=5&pageNo=1';
  try {
    const r = await fetch(url, { headers:{accept:'application/json'} });
    const j = JSON.parse(await r.text());
    const hd = (j.response && j.response.header) || j.header || {};
    if (String(hd.resultCode) === '22' || /LIMITED_NUMBER/.test(String(hd.resultMsg))) throw new Error('LIMIT');
    const body = (j.response && j.response.body) || j.body;
    let it = body && body.items && (body.items.item || body.items);
    if (!it) return null;
    if (!Array.isArray(it)) it = [it];
    const x = it[0];
    if (!x || !x.obsvtrNm) return null;
    return { code, name: String(x.obsvtrNm).trim(), la: +x.lat, lo: +x.lot };
  } catch(e){ if (e && e.message === 'LIMIT') throw e; return null; }
}

(async () => {
  let used = 0, found = 0;
  const have = new Set(st.points.map(p => p.code));
  const seenXY = {};
  st.points.forEach(p => { seenXY[(+p.la).toFixed(4) + ',' + (+p.lo).toFixed(4)] = 1; });
  for (const pre of ['SO','DT']){
    while (st.next[pre] <= RANGE[pre] && used < BUDGET){
      const code = pre + '_' + String(st.next[pre]).padStart(4,'0');
      st.next[pre]++;
      used++;
      let p = null;
      try { p = await probe(code); }
      catch(e){ console.log('하루 호출 한도에 닿음 — 내일 이어서'); st.next[pre]--; used = BUDGET; break; }
      if (p && !have.has(code) && isFinite(p.la) && isFinite(p.lo)){
        /* 「10년(마라도)_기점」은 기준면 산정용 가상 지점이라 예보 값이 실제 그 섬과 다르다(마라도는 2시간 어긋남). 버린다. */
        if (/기점/.test(p.name)) continue;
        var key = p.la.toFixed(4) + ',' + p.lo.toFixed(4);
        if (!seenXY[key]){ seenXY[key] = 1; st.points.push(p); have.add(code); found++; console.log('찾음', code, p.name); }
      }
      await sleep(110);
    }
  }
  st.done = st.next.SO > RANGE.SO && st.next.DT > RANGE.DT;
  st.points.sort((a,b) => a.code < b.code ? -1 : 1);
  fs.writeFileSync(FILE, JSON.stringify(st, null, 0));
  fs.writeFileSync('/tmp/tide_calls_used', String(used));
  console.log('이번에 호출', used, '· 새로 찾음', found, '· 누적', st.points.length, '· 진행', JSON.stringify(st.next), st.done ? '· 완료' : '');
})();
