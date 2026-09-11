// 해루낚 — 아이폰 홈 화면 물때 위젯 (Scriptable 용)
// 쓰는 법: Scriptable 앱에서 새 스크립트를 만들고 이 내용을 붙여 넣은 뒤,
//          홈 화면에 Scriptable 위젯을 놓고 이 스크립트를 고르면 됩니다.
// 관측소를 바꾸려면 아래 ST 값을 바꾸세요 (목록: haerunak.com/widget/ 에서 고른 뒤 주소의 st= 값).

const ST   = "DT_0001";                 // 기본 인천
const BASE = "https://haerunak.com";

function kstNow(){ const n = new Date(); return new Date(n.getTime() + (n.getTimezoneOffset() + 540) * 60000); }
function ds(d){ return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
function hhmm(h){ const t = Math.round(h*60); return String(Math.floor(t/60)%24).padStart(2,"0") + ":" + String(t%60).padStart(2,"0"); }

const SYN = 29.530588853;
const MUL = ["7물","8물","9물","10물","11물","12물","13물","조금","무시","1물","2물","3물","4물","5물","6물"];
function multtae(d){
  const jd = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 3) / 86400000 + 2440587.5;
  const age = ((jd - 2451550.26) % SYN + SYN) % SYN;
  let ld = Math.round(age) + 1; if (ld > 30) ld = 30;
  return MUL[(ld - 1) % 15];
}

const now = kstNow();
let ev = [];
try {
  const j = await new Request(`${BASE}/data/tide/${ds(now)}.json`).loadJSON();
  ev = j[ST] || [];
} catch (e) {}

const h = now.getHours() + now.getMinutes()/60;
const next = ev.find(e => e.t > h);

const w = new ListWidget();
w.backgroundColor = new Color("#0a1f2c");
w.url = `${BASE}/?mt=1`;
w.setPadding(14, 14, 12, 14);

const head = w.addStack();
const t1 = head.addText("오늘 물때");
t1.font = Font.semiboldSystemFont(11);
t1.textColor = new Color("#8ba6b8");
head.addSpacer();
const t2 = head.addText(multtae(now));
t2.font = Font.boldSystemFont(11);
t2.textColor = new Color("#2ee6a8");

w.addSpacer(6);

if (next) {
  const k = w.addText(next.k === "H" ? "다음 만조" : "다음 간조");
  k.font = Font.semiboldSystemFont(12);
  k.textColor = new Color("#8ba6b8");
  const v = w.addText(hhmm(next.t));
  v.font = Font.boldSystemFont(30);
  v.textColor = new Color(next.k === "H" ? "#7fd8cf" : "#ff9f7a");
  const left = Math.round((next.t - h) * 60);
  const r = w.addText(`${next.lv}cm · ${left >= 60 ? Math.floor(left/60) + "시간 " : ""}${left % 60}분 뒤`);
  r.font = Font.mediumSystemFont(12);
  r.textColor = new Color("#cadeeb");
} else {
  const k = w.addText(ev.length ? "오늘 물때는 끝" : "자료 없음");
  k.font = Font.boldSystemFont(18);
  k.textColor = new Color("#8ba6b8");
}

w.addSpacer(8);

const line = ev.map(e => `${e.k === "H" ? "만" : "간"} ${hhmm(e.t)}`).join("   ");
const l = w.addText(line || " ");
l.font = Font.mediumSystemFont(11);
l.textColor = new Color("#8ba6b8");
l.minimumScaleFactor = 0.7;

w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

if (config.runsInWidget) Script.setWidget(w);
else w.presentSmall();
Script.complete();
