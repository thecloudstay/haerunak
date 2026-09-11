/* 방문자 집계 — 측정 ID 만 넣으면 전 페이지에 붙는다.
   빈 문자열이면 아무것도 붙지 않는다 (지금 상태). */
const GA_ID = '';          // 예: 'G-XXXXXXXXXX'  ← 구글 애널리틱스
const CF_TOKEN = '';       // 예: '3e1c...'        ← 클라우드플레어 (둘 중 하나만 써도 된다)

function analyticsTags(){
  let out = '';
  if (GA_ID){
    out += `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>\n`
         + `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}`
         + `gtag('js',new Date());gtag('config','${GA_ID}');</script>\n`;
  }
  if (CF_TOKEN){
    out += `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" `
         + `data-cf-beacon='{"token":"${CF_TOKEN}"}'></script>\n`;
  }
  return out;
}
module.exports = { analyticsTags, GA_ID, CF_TOKEN };
