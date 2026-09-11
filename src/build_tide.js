/* 해루낚 — 지역별 물때 SEO 페이지 생성 (/tide/<슬러그>/)
   각 지역의 오늘 물때·만조간조·해루질 추천일 + 세부 포인트 목록. 검색 유입용 정적 페이지. */
const fs = require('fs');
const engine = fs.readFileSync('tide_engine.js', 'utf8');
global.Utilities = { formatDate: () => {} };
global.google = { script: { run: {} } };
eval(fs.readFileSync('Points.gs', 'utf8'));
const P = POINTS.filter(x => x && x.la && x.n);

// ── SEO 지역 정의: slug, 표시명, 검색키워드, 매칭 ──
const anmyeonKW = ['안면','꽃지','삼봉','기지포','밧개','백사장','샛별','바람아래','장곡','두여','두에기','황도','영목','방포'];
function inR(p, arr){ return arr.some(x => p.r.indexOf(x) >= 0); }
function nameHas(p, arr){ return arr.some(x => p.n.indexOf(x) >= 0); }
const REGIONS = [
 {slug:'ganghwa', name:'강화도', kw:'강화·석모도·교동도', m:p=>inR(p,['인천 강화'])},
 {slug:'incheon', name:'인천·김포', kw:'영종도·용유·김포', m:p=>inR(p,['인천 중구','인천 동구','인천 연수','경기 김포'])},
 {slug:'ongjin', name:'인천 섬(옹진)', kw:'영흥도·덕적도·자월도', m:p=>inR(p,['인천 옹진'])},
 {slug:'daebu', name:'대부도·시흥', kw:'대부도·오이도·구봉도', m:p=>inR(p,['경기 안산','경기 시흥'])},
 {slug:'jebu', name:'제부도·화성', kw:'제부도·궁평항·전곡항', m:p=>inR(p,['경기 화성','경기 평택'])},
 {slug:'dangjin', name:'당진', kw:'왜목마을·장고항', m:p=>inR(p,['충남 당진'])},
 {slug:'seosan', name:'서산', kw:'가로림만·삼길포·간월도', m:p=>inR(p,['충남 서산'])},
 {slug:'taean', name:'태안', kw:'만리포·학암포·몽산포', m:p=>inR(p,['충남 태안'])&&!nameHas(p,anmyeonKW)},
 {slug:'anmyeon', name:'안면도', kw:'꽃지·삼봉·밧개·기지포', m:p=>inR(p,['충남 태안'])&&nameHas(p,anmyeonKW)},
 {slug:'boryeong', name:'보령', kw:'무창포·대천·원산도', m:p=>inR(p,['충남 보령'])},
 {slug:'seocheon', name:'서천', kw:'춘장대·홍원항·마량', m:p=>inR(p,['충남 서천'])},
 {slug:'gunsan', name:'군산·고군산', kw:'선유도·무녀도·비응항', m:p=>inR(p,['전북 군산'])},
 {slug:'buan', name:'부안', kw:'변산·격포·곰소·위도', m:p=>inR(p,['전북 부안','전북 김제'])},
 {slug:'gochang', name:'고창', kw:'구시포·동호·하전갯벌', m:p=>inR(p,['전북 고창'])},
 {slug:'yeonggwang', name:'영광', kw:'가마미·백수·안마도', m:p=>inR(p,['전남 영광'])},
 {slug:'muan', name:'무안·함평', kw:'도리포·톱머리·돌머리', m:p=>inR(p,['전남 무안','전남 함평'])},
 {slug:'sinan', name:'신안', kw:'증도·자은도·천사대교', m:p=>inR(p,['전남 신안'])},
 {slug:'jindo', name:'진도', kw:'쉬미항·조도·팽목', m:p=>inR(p,['전남 진도'])},
 {slug:'mokpo', name:'목포', kw:'목포·외달도', m:p=>inR(p,['전남 목포'])},
 {slug:'yeosu', name:'여수', kw:'돌산·금오도·향일암', m:p=>inR(p,['전남 여수'])},
 {slug:'goheung', name:'고흥', kw:'나로도·녹동·거금도', m:p=>inR(p,['전남 고흥'])},
 {slug:'wando', name:'완도', kw:'신지도·청산도·약산', m:p=>inR(p,['전남 완도'])},
 {slug:'tongyeong', name:'통영', kw:'사량도·욕지도·미륵도', m:p=>inR(p,['경남 통영'])},
 {slug:'geoje', name:'거제', kw:'외포·구조라·지세포', m:p=>inR(p,['경남 거제'])},
 {slug:'namhae', name:'남해', kw:'미조·상주·지족해협', m:p=>inR(p,['경남 남해'])},
 {slug:'sacheon', name:'사천', kw:'삼천포·신수도·비토섬', m:p=>inR(p,['경남 사천'])},
 {slug:'changwon', name:'창원·진해', kw:'음지도·안골포', m:p=>inR(p,['경남 창원'])},
 {slug:'goseong', name:'고성(경남)', kw:'자란만·상족암', m:p=>inR(p,['경남 고성'])},
 {slug:'busan', name:'부산', kw:'기장·태종대·다대포', m:p=>inR(p,['부산'])},
 {slug:'ulsan', name:'울산', kw:'정자항·주전·진하', m:p=>inR(p,['울산'])},
 {slug:'gyeongju-pohang', name:'경주·포항', kw:'감포·구룡포·호미곶', m:p=>inR(p,['경북 경주','경북 포항'])},
 {slug:'yeongdeok-uljin', name:'영덕·울진', kw:'강구·축산·후포·죽변', m:p=>inR(p,['경북 영덕','경북 울진'])},
 {slug:'samcheok-donghae', name:'삼척·동해', kw:'임원·장호·묵호', m:p=>inR(p,['강원 삼척','강원 동해'])},
 {slug:'gangneung-yangyang', name:'강릉·양양', kw:'주문진·남애·사천', m:p=>inR(p,['강원 강릉','강원 양양'])},
 {slug:'sokcho-goseong', name:'속초·고성(강원)', kw:'외옹치·대포·아야진', m:p=>inR(p,['강원 속초','강원 고성'])},
 {slug:'jeju', name:'제주', kw:'제주 갯바위·해루질', m:p=>inR(p,['제주'])}
];

const _SPD = {'W':['바지락','낙지','동죽'],'S':['홍합','고둥','굴'],'E':['홍합','고둥','미역'],'J':['보말','오분자기','고둥']};
const _FXD = {'W':['우럭','망둥어','숭어'],'S':['감성돔','볼락','우럭'],'E':['벵에돔','볼락','우럭'],'J':['벵에돔','다금바리','우럭']};
function chips(a){ return (a||[]).slice(0,6).map(x=>'<span class="chip">'+x+'</span>').join(''); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const TPL = fs.readFileSync('tide_template.html','utf8');
let made = [];
REGIONS.forEach(R => {
  const pts = P.filter(R.m);
  if (pts.length < 2) return;
  // 대표 지점: mr 큰 순(서해)·있는 것 우선
  const rep = pts.slice().sort((a,b)=>(b.mr||0)-(a.mr||0))[0];
  const seaName = {W:'서해',S:'남해',E:'동해',J:'제주'}[rep.s] || '';
  // 포인트 카드
  const cards = pts.map(p=>{
    const sp = (p.sp&&p.sp.length)?p.sp:_SPD[p.s];
    const fx = (p.fx&&p.fx.length)?p.fx:_FXD[p.s];
    return '<div class="pt"><div class="pt-h"><b>'+esc(p.n)+'</b><span class="pt-r">'+esc(p.r)+'</span></div>'
      + (p.tag?'<p class="pt-tag">'+esc(p.tag)+'</p>':'')
      + '<div class="pt-sp"><span class="lab">채집</span>'+chips(sp)+'</div>'
      + '<div class="pt-fx"><span class="lab">어종</span>'+chips(fx)+'</div>'
      + '<a class="pt-go" href="https://haerunak.com/?spot='+p.i+'">지도에서 물때·추천 보기 →</a></div>';
  }).join('\n');
  // ── 지역 제철 캘린더: 이 지역 포인트의 대표 채집물·어종을 빈도순으로 뽑아 월별 제철 표시 ──
  const spCnt={}, fxCnt={};
  pts.forEach(p=>{ (p.sp||[]).forEach(x=>spCnt[x]=(spCnt[x]||0)+1); (p.fx||[]).forEach(x=>fxCnt[x]=(fxCnt[x]||0)+1); });
  const topSp = Object.keys(spCnt).filter(x=>SEASON_SP[x]).sort((a,b)=>spCnt[b]-spCnt[a]).slice(0,10);
  const topFx = Object.keys(fxCnt).filter(x=>SEASON_FX[x]).sort((a,b)=>fxCnt[b]-fxCnt[a]).slice(0,10);
  const seasonData = [];
  topSp.forEach(n=>seasonData.push({n:n,t:'sp',m:SEASON_SP[n]}));
  topFx.forEach(n=>seasonData.push({n:n,t:'fx',m:SEASON_FX[n]}));
  function seasRow(o){
    let tds='';
    for(let mi=0;mi<12;mi++){ const v=o.m[mi]||0; tds+='<td class="m'+v+'" data-mi="'+mi+'"></td>'; }
    return '<tr><td class="nm"><b>'+esc(o.n)+'</b><span class="tg '+o.t+'">'+(o.t==='sp'?'채집':'어종')+'</span></td>'+tds+'</tr>';
  }
  const seasonGrid = seasonData.length
    ? '<div class="seawrap"><table class="seas"><thead><tr><th class="nm">대상</th>'
      + [1,2,3,4,5,6,7,8,9,10,11,12].map(m=>'<th data-mi="'+(m-1)+'">'+m+'</th>').join('')
      + '</tr></thead><tbody>'+seasonData.map(seasRow).join('')+'</tbody></table></div>'
    : '';
  const seasonJSON = JSON.stringify(seasonData);
  const ptList = pts.map(p=>esc(p.n)).join(', ');
  const repJSON = JSON.stringify({n:rep.n,r:rep.r,la:rep.la,lo:rep.lo,mr:rep.mr,hi:rep.hi});
  const title = R.name+' 물때표 · 오늘 만조·간조 시각 | 해루낚';
  const desc = R.name+'('+R.kw+') 오늘의 물때와 만조·간조 시각, 조위(cm), 해루질 추천일(6~9물)을 한눈에. '+seaName+' '+pts.length+'개 포인트의 채집물·어종까지. 무료.';
  let html = TPL
    .replace(/__TITLE__/g, esc(title))
    .replace(/__DESC__/g, esc(desc))
    .replace(/__SLUG__/g, R.slug)
    .replace(/__RNAME__/g, esc(R.name))
    .replace(/__RKW__/g, esc(R.kw))
    .replace(/__SEA__/g, seaName)
    .replace(/__NPT__/g, pts.length)
    .replace(/__PTLIST__/g, esc(ptList))
    .replace(/__CARDS__/g, cards)
    .replace('__SEASONGRID__', seasonGrid)
    .replace(/__SEASONDATA__/g, seasonJSON)
    .replace(/__REP__/g, repJSON)
    .replace('/*__ENGINE__*/', engine);
  fs.mkdirSync('ghup/tide/'+R.slug, {recursive:true});
  fs.writeFileSync('ghup/tide/'+R.slug+'/index.html', html);
  made.push({slug:R.slug, name:R.name, n:pts.length, sea:seaName, kw:R.kw});
});

// ── /tide/ 인덱스 ──
const bySea = {};
made.forEach(m=>{ (bySea[m.sea]=bySea[m.sea]||[]).push(m); });
let idxBody = '';
['서해','남해','동해','제주'].forEach(sea=>{
  if(!bySea[sea]) return;
  idxBody += '<h2>'+sea+'</h2><div class="grid">'
    + bySea[sea].map(m=>'<a class="rcard" href="/tide/'+m.slug+'/"><b>'+esc(m.name)+' 물때표</b><span>'+esc(m.kw)+'</span><em>'+m.n+'개 포인트</em></a>').join('')
    + '</div>';
});
const idxTpl = fs.readFileSync('tide_index_template.html','utf8');
fs.writeFileSync('ghup/tide/index.html', idxTpl.replace('__BODY__', idxBody).replace(/__NREG__/g, made.length));

// ── sitemap 갱신: 기존에서 /tide/ 항목 제거 후 재추가 ──
let sm = fs.readFileSync('ghup/sitemap.xml','utf8');
// 기존 /tide/ 항목 전부 제거(줄 단위) 후 재추가 — 중복 누적 방지
sm = sm.split('\n').filter(l => l.indexOf('haerunak.com/tide/') < 0).join('\n');
const today = new Date(Date.now()+9*36e5).toISOString().slice(0,10);
let add = '<url><loc>https://haerunak.com/tide/</loc><lastmod>'+today+'</lastmod><priority>0.9</priority></url>\n';
made.forEach(m=>{ add += '<url><loc>https://haerunak.com/tide/'+m.slug+'/</loc><lastmod>'+today+'</lastmod><priority>0.8</priority></url>\n'; });
sm = sm.replace('</urlset>', add+'</urlset>');
fs.writeFileSync('ghup/sitemap.xml', sm);

console.log('생성 지역:', made.length, '| 총 포인트 커버:', made.reduce((a,b)=>a+b.n,0));
console.log('sitemap URL:', (sm.match(/<loc>/g)||[]).length);
