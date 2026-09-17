/**
 * 해루낚 도감 생성기
 *
 * 검색엔진이 읽을 수 있는 정적 페이지를 뽑는다.
 * 앱 본체(index.html)는 자바스크립트라 본문이 220자밖에 안 잡힌다.
 * 여기서 만드는 페이지는 지점 이름·어종·채비가 전부 HTML 안에 그대로 들어간다.
 *
 * 넣지 않는 것: 물때, 날씨, 점수 — 매일 바뀌는 값은 색인을 흔든다.
 * 그런 건 앱으로 보낸다.
 */
const fs = require('fs');
const path = require('path');

const D = JSON.parse(fs.readFileSync('atlas_data.json', 'utf8'));
const OUT = 'ghup';
const SITE = 'https://haerunak.com';   // 개인 도메인 사면 여기만 바꾸면 된다
const TODAY = D.generated;

/* 검색엔진 소유권 확인 — 구글 서치콘솔·네이버 서치어드바이저에서 받은 값을 여기 넣으면
   모든 페이지에 자동으로 붙는다. 빈 값이면 아무것도 출력하지 않는다. */
const VERIFY = {
  google: '',   // <meta name="google-site-verification" content="여기">
  naver:  '91e427302481f46851e378e769ad02f7d8660b2d'   // 네이버 서치어드바이저 소유확인
};
const verifyTags = () =>
  (VERIFY.google ? `<meta name="google-site-verification" content="${VERIFY.google}">\n` : '')
  + (VERIFY.naver ? `<meta name="naver-site-verification" content="${VERIFY.naver}">\n` : '');

/* ── 유틸 ── */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const slug = s => encodeURIComponent(String(s).replace(/\s+/g,'-'));


/* ── 밤낮·물때 성질을 엔진에서 그대로 읽어 온다 ──
   이 파일 맨 위에 「물때는 넣지 않는다」고 적어 두었는데, 그건 오늘의 물때 이야기다.
   「붕장어는 밤에만 문다」, 「낙지는 사리에 드러난다」는 날짜가 바뀌어도 그대로인 성질이라
   정적 페이지에 들어가야 맞다. 색인을 흔들지 않으면서 검색으로 들어온 사람에게 쓸모가 있다.
   표를 여기서 다시 쓰지 않고 Score.gs 것을 읽는 이유는, 두 벌이 되면 언젠가 어긋나기 때문이다. */
const TRAITS = (function(){
  try {
    const src = fs.readFileSync('Score.gs', 'utf8');
    const grab = name => {
      const m = src.match(new RegExp('var\\s+' + name + '\\s*=\\s*\\{[\\s\\S]*?\\n\\};'));
      return m ? m[0] : null;
    };
    const parts = ['SP_NIGHT','FLAT_ZONE','FISH_SPRING','FISH_TIDE','HAERU_TIDE']
      .map(grab).filter(Boolean).join('\n');
    const out = {};
    new Function('o', parts + '\n; o.SP_NIGHT=typeof SP_NIGHT!=="undefined"?SP_NIGHT:{};'
      + 'o.FLAT_ZONE=typeof FLAT_ZONE!=="undefined"?FLAT_ZONE:{};'
      + 'o.FISH_SPRING=typeof FISH_SPRING!=="undefined"?FISH_SPRING:{};'
      + 'o.FISH_TIDE=typeof FISH_TIDE!=="undefined"?FISH_TIDE:{};'
      + 'o.HAERU_TIDE=typeof HAERU_TIDE!=="undefined"?HAERU_TIDE:{};')(out);
    return out;
  } catch(e){
    console.log('  주의 — 밤낮·물때 표를 못 읽었습니다: ' + e.message);
    return { SP_NIGHT:{}, FLAT_ZONE:{}, FISH_SPRING:{}, FISH_TIDE:{}, HAERU_TIDE:{} };
  }
})();

const NIGHT_WORD = { '2':'밤에만 나옵니다', '1':'밤이 낫습니다', '0':'밤낮 차이가 없습니다',
                     '-1':'낮이 낫습니다', '-2':'낮에만 나옵니다' };
const ZONE_WORD = {
  up:  ['갯벌 위쪽', '조금 물때에도 드러나는 자리입니다. 물이 조금만 빠져도 손이 닿습니다.'],
  mid: ['갯벌 가운데', '보통 물때면 드러납니다. 호미로 파는 자리입니다.'],
  low: ['갯벌 아래쪽', '사리처럼 크게 빠지는 날이라야 드러납니다. 물때를 꼭 보고 가세요.']
};
const STAGE_WORD = { flood:'들물(밀물)', ebb:'날물(썰물)', high:'만조 부근', low:'간조 부근',
                     move:'물이 흐를 때(정조에는 뜸합니다)' };
const SPRING_WORD = { '1':'사리처럼 물살이 센 물때', '-1':'조금처럼 물살이 약한 물때',
                      '0.5':'사리와 조금 사이, 중간 물때' };

/* 그 대상의 성질을 한 덩어리로 — 없으면 빈 문자열 */
function traitBlock(name, kind){
  const nb = TRAITS.SP_NIGHT[name];
  const zone = TRAITS.FLAT_ZONE[name];
  const stage = kind === 'fish' ? TRAITS.FISH_TIDE[name] : TRAITS.HAERU_TIDE[name];
  const spring = TRAITS.FISH_SPRING[name];
  const rows = [];
  if (nb && nb[0] !== 0){
    let t = NIGHT_WORD[String(nb[0])];
    if (nb[1]) t += ' — ' + nb[1];
    if (nb[2]) t += '. 집어등 불빛에 모입니다';
    rows.push(['밤·낮', t]);
  } else if (nb){
    rows.push(['밤·낮', NIGHT_WORD['0']]);
  }
  if (zone && ZONE_WORD[zone]) rows.push(['갯벌 어디쯤', ZONE_WORD[zone][0] + ' — ' + ZONE_WORD[zone][1]]);
  if (stage && stage !== 'any' && STAGE_WORD[stage]) rows.push(['어느 물때', STAGE_WORD[stage] + '에 잘 됩니다']);
  if (spring !== undefined && SPRING_WORD[String(spring)]) rows.push(['사리·조금', SPRING_WORD[String(spring)] + '가 낫습니다']);
  if (!rows.length) return '';
  return `<section><h2>언제 나오나</h2>
<dl class="traits">${rows.map(r => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>
<p class="cap">조황·생태 자료에서 근거를 찾은 것만 적었습니다. 근거를 못 찾은 항목은 아예 비워 둡니다.</p></section>`;
}
/* 목록에 붙이는 작은 표시 */
function nightMark(name){
  const nb = TRAITS.SP_NIGHT[name];
  if (!nb || nb[0] === 0) return '';
  return nb[0] > 0 ? ' 🌙' : ' ☀';
}

function ensure(dir){ fs.mkdirSync(dir, { recursive:true }); }

/* ── 공통 껍데기 ── */
function shell(o){
  const canon = SITE + o.url;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc)}">
<link rel="canonical" href="${canon}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="해루낚">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:url" content="${canon}">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#05141f">
${verifyTags()}
<link rel="icon" type="image/svg+xml" href="${o.depth === 0 ? '' : '../'}icon.svg">
<link rel="apple-touch-icon" href="${o.depth === 0 ? '' : '../'}icon.svg">
<link rel="stylesheet" href="${o.depth === 0 ? '' : '../'}atlas.css">
${require('./analytics.js').analyticsTags()}${o.ld ? '<script type="application/ld+json">' + JSON.stringify(o.ld) + '</script>' : ''}
</head>
<body>
<header class="top">
  <a class="brand" href="${o.depth === 0 ? './' : '../'}">해루낚</a>
  <nav>
    <a href="${o.depth === 0 ? '' : '../'}species/">어종 도감</a>
    <a href="${o.depth === 0 ? '' : '../'}spot/">포인트</a>
    <a href="${o.depth === 0 ? '' : '../'}tide/">지역 물때</a>
    <a href="${o.depth === 0 ? '' : '../'}calendar/">물때달력</a>
    <a href="${o.depth === 0 ? '' : '../'}method/">계산 근거</a>
    <a href="${o.depth === 0 ? '' : '../'}partner/">채널 제휴</a>
    <a href="${o.depth === 0 ? '' : '../'}business/">업체 등록</a>
    <a class="app" href="${o.depth === 0 ? '' : '../'}index.html">오늘 어디 갈까</a>
  </nav>
</header>
<main>
${o.body}
</main>
<footer class="foot">
  <p><a href="${o.depth === 0 ? '' : '../'}index.html">해루낚</a> — 물때 해석은 앱이 합니다. 어디 가서 뭘 잡을지 결론만 보세요.</p>
  <p class="fine">채집·낚시 규정은 시·도 고시에 따라 달라집니다. 출조 전 해당 지역 최신 고시를 확인하세요. 안전 판단은 항상 현장에서 직접 하십시오.</p>
  <p class="fine">유튜브·블로그 채널 운영자시라면 <a href="${o.depth === 0 ? '' : '../'}partner/">채널 제휴 안내</a>,
     낚싯배·민박·낚시점을 운영하시면 <a href="${o.depth === 0 ? '' : '../'}business/">업체 등록 안내</a>를 보세요.
     문의 <a href="mailto:thecloudstay@gmail.com">thecloudstay@gmail.com</a></p>
</footer>
</body>
</html>`;
}

/* ── 제철 달력 ── */
function seasonBar(cal){
  if (!cal) return '';
  const cells = cal.map((v, i) => {
    const lvl = v >= 3 ? 'peak' : v === 2 ? 'good' : v === 1 ? 'ok' : 'off';
    const word = v >= 3 ? '한창' : v === 2 ? '좋음' : v === 1 ? '조금' : '철 아님';
    return `<div class="mo ${lvl}"><span class="m">${i+1}</span><span class="v" title="${word}">${word}</span></div>`;
  }).join('');
  return `<div class="season" role="img" aria-label="월별 제철">${cells}</div>`;
}

function seasonWords(cal){
  if (!cal) return '';
  const best = [];
  cal.forEach((v,i)=>{ if (v >= 3) best.push(i+1); });
  if (!best.length) cal.forEach((v,i)=>{ if (v === 2) best.push(i+1); });
  if (!best.length) return '';
  // 연속 구간으로 묶어 읽기 좋게
  const runs = [];
  best.forEach(m => {
    const last = runs[runs.length-1];
    if (last && m === last[last.length-1] + 1) last.push(m);
    else runs.push([m]);
  });
  return runs.map(r => r.length > 1 ? `${r[0]}~${r[r.length-1]}월` : `${r[0]}월`).join(', ');
}

/* ── 금어기 문장 ── */
function banText(b){
  if (!b) return '';
  const parts = [];
  if (b.b && b.b.length){
    const seg = b.b.map(x => Array.isArray(x[0])
      ? `${x[0][0]}월 ${x[0][1]}일~${x[1][0]}월 ${x[1][1]}일`
      : `${x[0]}월 ${x[1]}일`);
    // [[시작월,일],[끝월,일]] 형태
    if (b.b.length === 2 && !Array.isArray(b.b[0][0])){
      parts.push(`${b.b[0][0]}월 ${b.b[0][1]}일 ~ ${b.b[1][0]}월 ${b.b[1][1]}일`);
    } else {
      parts.push(seg.join(', '));
    }
  }
  return parts.join(' · ');
}

/* ══════════ 어종 페이지 ══════════ */
function speciesPage(s){
  const kindWord = s.kind === 'fish' ? '낚시 대상어' : s.kind === 'both' ? '해루질·낚시 대상' : '해루질 채집물';
  const best = seasonWords(s.season);
  const desc = `${s.n} — ${kindWord}. ${best ? '제철 ' + best + '. ' : ''}`
    + (s.rig && s.rig.t ? '준비물: ' + s.rig.t.slice(0,3).join('·') + '. ' : '')
    + (s.spots.length ? `전국 ${s.spots.length}곳에서 노릴 수 있습니다.` : '');

  const spotList = s.spots
    .map(i => D.points.find(p => p.i === i))
    .filter(Boolean)
    .sort((a,b) => a.n.localeCompare(b.n,'ko'));

  const byRegion = {};
  spotList.forEach(p => { (byRegion[p.sea] = byRegion[p.sea] || []).push(p); });

  let body = `<article class="page">
<nav class="crumb"><a href="../species/">어종 도감</a> <span>›</span> ${esc(s.n)}</nav>
<h1>${esc(s.n)}</h1>
<p class="kicker">${kindWord}${best ? ' · 제철 ' + esc(best) : ''}</p>`;

  if (s.ban){
    const bt = banText(s.ban);
    body += `<div class="alert">
<strong>금어기 있음</strong>
<p>${bt ? esc(bt) + ' 기간에는 잡을 수 없습니다.' : '금어기 규정이 있습니다.'}
${s.ban.z ? ` 금지체장 ${esc(s.ban.z)}cm(${esc(s.ban.u||'전장')}) 미만은 놓아주어야 합니다.` : ''}
${s.ban.rg ? ` 적용 ${esc(s.ban.rg)}.` : ''}</p>
${s.ban.note ? `<p class="note">${esc(s.ban.note)}</p>` : ''}
</div>`;
  }

  if (s.season){
    body += `<section><h2>언제 잡히나</h2>${seasonBar(s.season)}
<p class="cap">색이 진할수록 제철입니다. 지역과 그 해 수온에 따라 앞뒤로 밀립니다.</p></section>`;
  }

  body += traitBlock(s.n, s.kind === 'fish' ? 'fish' : 'haeru');

  if (s.rig){
    body += `<section><h2>준비물과 채비</h2>`;
    if (s.rig.t && s.rig.t.length)
      body += `<ul class="chips">${s.rig.t.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`;
    if (s.rig.b) body += `<p class="bait"><b>미끼·루어</b> ${esc(s.rig.b)}</p>`;
    if (s.rig.tip) body += `<p class="tip"><b>요령</b> ${esc(s.rig.tip)}</p>`;
    if (s.rig.warn) body += `<p class="warn"><b>주의</b> ${esc(s.rig.warn)}</p>`;
    body += `</section>`;
  }

  if (spotList.length){
    body += `<section><h2>어디서 잡히나</h2>
<p class="cap">전국 ${spotList.length}곳입니다. 지점을 누르면 그곳 정보로 갑니다.</p>`;
    Object.keys(byRegion).forEach(sea => {
      body += `<h3 class="sub">${esc(sea)} <em>${byRegion[sea].length}곳</em></h3>
<ul class="linklist">${byRegion[sea].map(p =>
  `<li><a href="../spot/${p.i}.html">${esc(p.n)}</a><span>${esc(p.r)}</span></li>`).join('')}</ul>`;
    });
    body += `</section>`;
  } else {
    body += `<section><h2>어디서 잡히나</h2>
<p class="cap">아직 이 어종으로 등록된 지점이 없습니다. 앱에서 조건에 맞는 자리를 찾아보세요.</p></section>`;
  }

  // 같은 철에 함께 노릴 수 있는 것 — 헛걸음을 줄여준다
  if (s.season){
    const mine = s.season;
    const mates = D.species.filter(o => {
      if (o.n === s.n || !o.season) return false;
      if (o.kind !== s.kind && s.kind !== 'both' && o.kind !== 'both') return false;
      let overlap = 0;
      for (let m = 0; m < 12; m++) if (mine[m] >= 2 && o.season[m] >= 2) overlap++;
      return overlap >= 4;
    }).slice(0, 10);
    if (mates.length){
      body += `<section><h2>같은 철에 함께 나오는 것</h2>
<p class="cap">한 번 나갈 때 같이 노릴 수 있습니다. 대상이 여럿이면 헛걸음 확률이 줄어듭니다.</p>
<ul class="chips lk">${mates.map(o=>`<li><a href="${slug(o.n)}.html">${esc(o.n)}</a></li>`).join('')}</ul></section>`;
    }
  }

  // 해루질 채집물이면 비어업인 규정을 알려야 한다 — 모르고 어기는 일이 많다
  if (s.kind !== 'fish' && D.nonpro && D.nonpro.length){
    body += `<section><h2>비어업인이 지켜야 할 것</h2>
<p class="cap">어업 허가 없이 취미로 잡는 사람에게 적용됩니다. 금어기와 별개입니다.</p>
<div class="rules">${D.nonpro.slice(0,5).map(r => `<div class="rule">
<b>${esc(r.t || r.n || '')}</b>${r.d ? `<p>${esc(r.d)}</p>` : ''}
</div>`).join('')}</div></section>`;
  }

  // 안전 — 대상과 무관하게 항상
  if (s.kind !== 'fish' && D.safeKit && D.safeKit.length){
    body += `<section><h2>안전 장비</h2>
<p class="cap">밤 갯벌에서 길을 잃거나 물에 갇히는 사고가 매년 납니다. 대상물과 무관하게 챙기세요.</p>
<ul class="chips">${D.safeKit.map(t=>`<li>${esc(t)}</li>`).join('')}</ul></section>`;
  }

  body += `<section class="cta">
<h2>오늘 ${esc(s.n)} 잡으러 갈 만한가</h2>
<p>물때·수중시야·바람·수온을 종합해 오늘 점수가 가장 높은 자리를 알려드립니다.</p>
<a class="btn" href="../index.html?sp=${slug(s.n)}">${esc(s.n)} 노릴 자리 보기</a>
</section>
<section><h2>${esc(s.n)} 영상을 가지고 계신가요</h2>
<div class="joinbox jb-ch">
<b>유튜브·블로그 하시면 앱에 걸어드립니다</b>
<p>${esc(s.n)}철이 되면 그 영상이 첫 화면에 자동으로 붙습니다. 노출료는 받지 않습니다.</p>
<a class="joinbox-a" href="../partner/">채널 제휴 안내 보기 →</a>
</div>
</section>
</article>`;

  return shell({
    title: `${s.n} — 제철·금어기·채비 | 해루낚 어종 도감`,
    desc: desc.slice(0, 155),
    url: `/species/${slug(s.n)}.html`,
    depth: 1,
    body,
    ld: {
      '@context':'https://schema.org', '@type':'Article',
      headline: `${s.n} 잡는 법 — 제철, 금어기, 채비`,
      inLanguage:'ko-KR', datePublished: TODAY,
      publisher:{ '@type':'Organization', name:'해루낚' }
    }
  });
}

/* ══════════ 지점 페이지 ══════════ */
function spotPage(p){
  const all = p.haeru.concat(p.fish.filter(x => p.haeru.indexOf(x) < 0));
  const desc = `${p.n}(${p.r}) — ${p.sea} ${p.floor} 지형. `
    + (all.length ? `${all.slice(0,4).join('·')} 등을 노릴 수 있습니다. ` : '')
    + (p.isl && p.fr ? `${p.fr[0]}에서 배로 약 ${p.fr[1]}분. ` : '')
    + `평균 조차 ${p.mr}m.`;

  let body = `<article class="page">
<nav class="crumb"><a href="../spot/">포인트</a> <span>›</span> ${esc(p.n)}</nav>
<h1>${esc(p.n)}</h1>
<p class="kicker">${esc(p.r)} · ${esc(p.sea)}${p.isl ? ' · 섬' : ''}</p>`;

  if (p.tag) body += `<p class="lead">${esc(p.tag)}</p>`;

  body += `<section><h2>이런 곳입니다</h2>
<dl class="facts">
<div><dt>해역</dt><dd>${esc(p.sea)}</dd></div>
<div><dt>바닥질</dt><dd>${esc(p.floor) || '정보 없음'}</dd></div>
<div><dt>평균 조차</dt><dd>${p.mr}m</dd></div>
<div><dt>지형</dt><dd>${p.isl ? '섬 (배편 필요)' : '육지에서 진입'}</dd></div>
</dl></section>`;

  if (p.isl && p.fr){
    body += `<section><h2>들어가는 길</h2>
<p><strong>${esc(p.fr[0])}</strong>에서 배로 약 <strong>${p.fr[1]}분</strong>
${p.fr[2] ? '· 차량 선적이 됩니다.' : '· 차는 두고 들어가야 합니다.'}</p>
<p class="cap">해루질은 간조 전후가 핵심인데 그 시간에 배가 없는 날이 많습니다.
앱에서 그날 물때와 배 시간이 맞는지, 1박이 필요한지 알려드립니다.</p>
<ul class="linklist out">
<li><a href="https://island.theksa.co.kr/" rel="noopener" target="_blank">여객선 예매</a><span>한국해운조합</span></li>
<li><a href="https://www.komsa.or.kr/prog/dailyCurState/kor/sub03_0201/list.do" rel="noopener" target="_blank">실시간 운항현황</a><span>결항 확인</span></li>
</ul></section>
<section><h2>이 항로에 배를 가지고 계신가요</h2>
<div class="joinbox jb-biz">
<b>낚싯배·유어선·민박을 하시면 이 페이지에 올려드립니다</b>
<p>${esc(p.n)}을 검색해서 들어온 사람에게 바로 보입니다. 등록은 무료이고, 예약이 성사된 것에만 수수료를 받습니다.</p>
<a class="joinbox-a" href="../business/">업체 등록 안내 보기 →</a>
</div></section>`;
  }

  if (p.haeru.length){
    body += `<section><h2>해루질로 잡히는 것</h2>
<ul class="chips lk">${p.haeru.map(n=>`<li><a href="../species/${slug(n)}.html">${esc(n)}${nightMark(n)}</a></li>`).join('')}</ul>
<p class="cap">🌙 밤에 나옵니다 · ☀ 낮에 나옵니다 · 표시 없으면 밤낮 차이가 없거나 아직 자료가 없습니다.</p></section>`;
  }
  if (p.fish.length){
    body += `<section><h2>낚시 대상어</h2>
<ul class="chips lk">${p.fish.map(n=>`<li><a href="../species/${slug(n)}.html">${esc(n)}${nightMark(n)}</a></li>`).join('')}</ul>
<p class="cap">🌙 밤에 뭅니다 · ☀ 낮에 뭅니다 · 표시 없으면 밤낮 차이가 없거나 아직 자료가 없습니다.</p></section>`;
  }

  if (p.spots && p.spots.length){
    body += `<section><h2>세부 자리</h2>
<p class="cap">현지에서 실제로 들어가는 자리들입니다.</p>
<div class="spots">${p.spots.map(sp => `<div class="sp">
<b>${esc(sp.n || '')}</b>
${sp.d ? `<p>${esc(sp.d)}</p>` : ''}
${(sp.t && sp.t.length) ? `<ul class="chips lk sm">${sp.t.map(t=>`<li><a href="../species/${slug(t)}.html">${esc(t)}</a></li>`).join('')}</ul>` : ''}
${sp.w ? `<p class="warn sm">주의 — ${esc(sp.w)}</p>` : ''}
</div>`).join('')}</div></section>`;
  }

  // 월별로 뭐가 나오나 — 지점 페이지에서 가장 쓸모 있는 표
  const cal = [];
  for (let m = 0; m < 12; m++){
    const hit = all.map(n => D.species.find(x => x.n === n))
      .filter(x => x && x.season && x.season[m] >= 2)
      .sort((a,b) => b.season[m] - a.season[m])
      .slice(0, 5);
    cal.push(hit);
  }
  if (cal.some(x => x.length)){
    body += `<section><h2>달마다 뭐가 나오나</h2>
<p class="cap">이 자리에서 그 달에 노릴 만한 것들입니다. 지역 수온에 따라 앞뒤로 밀립니다.</p>
<div class="montab">${cal.map((hit, m) => `<div class="mrow${hit.length ? '' : ' empty'}">
<span class="mn">${m+1}월</span>
<span class="ml">${hit.length ? hit.map(x=>`<a href="../species/${slug(x.n)}.html">${esc(x.n)}</a>`).join('') : '<i>이렇다 할 것이 없습니다</i>'}</span>
</div>`).join('')}</div></section>`;
  }

  // 조차가 말해주는 것
  if (p.mr){
    const mrWord = p.mr >= 7 ? '전국에서도 손꼽히게 큰 편입니다. 물이 멀리까지 빠지는 대신 들어올 때도 빠릅니다.'
      : p.mr >= 5 ? '큰 편입니다. 사리 물때에는 갯벌이 넓게 드러납니다.'
      : p.mr >= 3 ? '보통입니다. 사리와 조금의 차이가 뚜렷합니다.'
      : p.mr >= 1 ? '작은 편입니다. 갯벌 노출보다 물속 작업이나 낚시에 맞습니다.'
      : '거의 없습니다. 해루질보다 낚시 쪽입니다.';
    body += `<section><h2>물이 얼마나 빠지나</h2>
<p>평균 조차 <strong>${p.mr}m</strong>. ${mrWord}</p>
<p class="cap">사리 때는 이보다 더 빠지고 조금 때는 덜 빠집니다. 그날 실제 조차와 간조 시각은 앱에서 확인하세요.</p></section>`;
  }

  // 인근 지점 — 헛걸음했을 때 대안
  const near = D.points.filter(o => o.i !== p.i && o.r === p.r).slice(0, 8);
  if (near.length){
    body += `<section><h2>근처 다른 자리</h2>
<p class="cap">조건이 안 맞는 날 대안으로 봐두세요.</p>
<ul class="linklist">${near.map(o =>
  `<li><a href="${o.i}.html">${esc(o.n)}</a><span>${o.isl ? '섬' : '육지'} · 조차 ${o.mr}m</span></li>`).join('')}</ul></section>`;
  }

  body += `<section class="cta">
<h2>오늘 ${esc(p.n)} 어떤가</h2>
<p>물때, 수중시야, 갯벌이 얼마나 드러나는지, 바람과 파고까지 종합해 0~100점으로 알려드립니다.</p>
<a class="btn" href="../index.html?spot=${p.i}">${esc(p.n)} 오늘 점수 보기</a>
</section>
<section><h2>이 자리 영상을 가지고 계신가요</h2>
<div class="joinbox jb-ch">
<b>유튜브·블로그 하시면 앱 첫 화면에 걸어드립니다</b>
<p>${esc(p.n)}이 그날 원픽으로 뜰 때마다 그 영상이 자동으로 붙습니다. 노출료는 받지 않습니다.</p>
<a class="joinbox-a" href="../partner/">채널 제휴 안내 보기 →</a>
</div>
</section>
</article>`;

  return shell({
    title: `${p.n} 해루질·낚시 포인트 — ${p.r} | 해루낚`,
    desc: desc.slice(0, 155),
    url: `/spot/${p.i}.html`,
    depth: 1,
    body,
    ld: {
      '@context':'https://schema.org', '@type':'Place',
      name: p.n, address: p.r, inLanguage:'ko-KR',
      geo: { '@type':'GeoCoordinates', latitude:p.la, longitude:p.lo }
    }
  });
}

/* ══════════ 색인 ══════════ */
function speciesIndex(){
  const haeru = D.species.filter(s => s.kind !== 'fish');
  const fish  = D.species.filter(s => s.kind !== 'haeru');
  const sec = (title, arr, note) => `<section><h2>${title} <em>${arr.length}종</em></h2>
<p class="cap">${note}</p>
<ul class="grid">${arr.map(s => {
    const b = seasonWords(s.season);
    return `<li><a href="${slug(s.n)}.html"><b>${esc(s.n)}</b>${b ? `<span>${esc(b)}</span>` : ''}${s.ban ? '<i>금어기</i>' : ''}</a></li>`;
  }).join('')}</ul></section>`;

  const body = `<article class="page">
<h1>어종 도감</h1>
<p class="lead">${D.species.length}종의 제철, 금어기, 준비물과 채비, 잡히는 자리를 정리했습니다.</p>
${sec('해루질 채집물', haeru, '갯벌과 얕은 물에서 맨손·도구로 잡는 것들입니다.')}
${sec('낚시 대상어', fish, '갯바위·방파제·선상에서 노리는 어종입니다.')}
</article>`;

  return shell({
    title: '어종 도감 — 제철·금어기·채비 | 해루낚',
    desc: `해루질 채집물과 낚시 대상어 ${D.species.length}종의 제철, 금어기, 준비물, 잡히는 자리를 한눈에.`,
    url: '/species/', depth: 1, body
  });
}

function spotIndex(){
  const bySea = {};
  D.points.forEach(p => { (bySea[p.sea] = bySea[p.sea] || []).push(p); });
  const order = ['서해','남해','동해','제주'];
  const body = `<article class="page">
<h1>전국 포인트</h1>
<p class="lead">해루질·낚시 정밀 분석 지점 ${D.points.length}곳입니다. 그중 ${D.points.filter(p=>p.isl).length}곳이 섬입니다.</p>
${order.filter(s=>bySea[s]).map(sea => `<section><h2>${sea} <em>${bySea[sea].length}곳</em></h2>
<ul class="grid">${bySea[sea].map(p =>
  `<li><a href="${p.i}.html"><b>${esc(p.n)}</b><span>${esc(p.r)}</span>${p.isl ? '<i>섬</i>' : ''}</a></li>`).join('')}</ul></section>`).join('')}
</article>`;

  return shell({
    title: `전국 해루질·낚시 포인트 ${D.points.length}곳 | 해루낚`,
    desc: `서해·남해·동해·제주 정밀 분석 포인트 ${D.points.length}곳. 지역별로 어떤 대상물이 나오는지 정리했습니다.`,
    url: '/spot/', depth: 1, body
  });
}

/* ══════════ 실행 ══════════ */
ensure(path.join(OUT,'species'));
ensure(path.join(OUT,'spot'));

let n = 0;
const urls = [];

D.species.forEach(s => {
  const f = path.join(OUT,'species', decodeURIComponent(slug(s.n)) + '.html');
  fs.writeFileSync(f, speciesPage(s)); n++;
  urls.push({ loc: `${SITE}/species/${slug(s.n)}.html`, pri: '0.8' });
});
D.points.forEach(p => {
  fs.writeFileSync(path.join(OUT,'spot', p.i + '.html'), spotPage(p)); n++;
  urls.push({ loc: `${SITE}/spot/${p.i}.html`, pri: '0.8' });
});

fs.writeFileSync(path.join(OUT,'species','index.html'), speciesIndex()); n++;
fs.writeFileSync(path.join(OUT,'spot','index.html'), spotIndex()); n++;
urls.unshift({ loc: `${SITE}/spot/`, pri: '0.9' });
urls.unshift({ loc: `${SITE}/species/`, pri: '0.9' });
urls.push({ loc: `${SITE}/method/`, pri: '0.8' });
urls.push({ loc: `${SITE}/partner/`, pri: '0.7' });
urls.push({ loc: `${SITE}/business/`, pri: '0.75' });
urls.unshift({ loc: `${SITE}/`, pri: '1.0' });

/* 사이트맵 */
fs.writeFileSync(path.join(OUT,'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `<url><loc>${u.loc}</loc><lastmod>${TODAY}</lastmod><priority>${u.pri}</priority></url>`).join('\n')}
</urlset>`);

fs.writeFileSync(path.join(OUT,'robots.txt'),
`# 해루낚 — 전국 해루질·낚시 포인트와 어종 도감

User-agent: *
Allow: /

# 네이버 검색로봇 — 명시해야 잘 수집한다
User-agent: Yeti
Allow: /

# 구글
User-agent: Googlebot
Allow: /

# 다음
User-agent: Daumoa
Allow: /

# 빙
User-agent: bingbot
Allow: /

Sitemap: ${SITE}/sitemap.xml
`);

console.log('페이지', n, '개 생성');
console.log('사이트맵 항목', urls.length, '개');
