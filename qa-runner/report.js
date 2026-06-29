/** 동작 전/후 스크린샷을 나란히 보여주는 HTML 리포트 생성 */
const fs = require('fs');
const path = require('path');

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function buildReport(meta, steps, outDir) {
  const pass = steps.filter(s=>s.status==='pass').length;
  const fail = steps.filter(s=>s.status==='fail').length;
  const warn = steps.filter(s=>s.status==='warn').length;

  const rows = steps.map((s,i)=>{
    const badge = s.status==='pass' ? '<span class="b ok">PASS</span>'
                : s.status==='fail' ? '<span class="b bad">FAIL</span>'
                : '<span class="b warn">확인</span>';
    const img = (f,label)=> f
      ? `<figure><figcaption>${label}</figcaption><a href="${esc(f)}" target="_blank"><img src="${esc(f)}" loading="lazy"></a></figure>`
      : `<figure class="empty"><figcaption>${label}</figcaption><div class="ph">(없음)</div></figure>`;
    return `<section class="step">
      <h3><span class="num">${String(i+1).padStart(2,'0')}</span> ${esc(s.title)} ${badge}</h3>
      ${s.note?`<p class="note">${esc(s.note)}</p>`:''}
      <div class="imgs">${img(s.before,'동작 전 (before)')}${img(s.after,'동작 후 (after)')}</div>
    </section>`;
  }).join('\n');

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>RBI QA 리포트 ${esc(meta.stamp)}</title>
<style>
  body{margin:0;font-family:'Malgun Gothic','Segoe UI',sans-serif;background:#eef1f8;color:#1f2a44}
  header{background:linear-gradient(100deg,#3a52e6,#6a5cf7,#8b5cf6);color:#fff;padding:18px 28px}
  header h1{margin:0;font-size:19px} header .meta{font-size:12.5px;color:#dfe6ff;margin-top:6px}
  .sum{display:flex;gap:10px;margin:18px 28px}
  .sum div{background:#fff;border:1px solid #e3e8f2;border-radius:12px;padding:10px 18px;font-size:13px;box-shadow:0 6px 24px rgba(38,54,110,.07)}
  .sum b{font-size:18px;display:block}
  .ok{color:#16a34a}.bad{color:#dc2626}.warn{color:#d97706}
  main{max-width:1180px;margin:0 auto;padding:0 28px 60px}
  .step{background:#fff;border:1px solid #e3e8f2;border-radius:16px;padding:18px 20px;margin:16px 0;box-shadow:0 6px 24px rgba(38,54,110,.07)}
  .step h3{margin:0 0 10px;font-size:15px;display:flex;align-items:center;gap:10px}
  .num{width:26px;height:26px;border-radius:50%;background:#4f6cf7;color:#fff;font-size:12px;display:inline-flex;align-items:center;justify-content:center}
  .b{font-size:11px;font-weight:700;border-radius:6px;padding:2px 9px;color:#fff}
  .b.ok{background:#16a34a}.b.bad{background:#dc2626}.b.warn{background:#d97706}
  .note{font-size:12.5px;color:#7b88a8;margin:0 0 10px;background:#f6f8fe;border-radius:8px;padding:8px 12px}
  .imgs{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:760px){.imgs{grid-template-columns:1fr}}
  figure{margin:0} figcaption{font-size:12px;color:#7b88a8;margin-bottom:6px;font-weight:600}
  img{width:100%;border:1px solid #e3e8f2;border-radius:10px;display:block}
  .empty .ph{height:160px;border:1px dashed #e3e8f2;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#9aa6c2;font-size:13px}
</style></head><body>
<header>
  <h1>🛡️ AirRBI 사용자 포털 — QA 자동화 리포트</h1>
  <div class="meta">실행시각 ${esc(meta.stamp)} · 대상 ${esc(meta.domain)} · 계정 ${esc(meta.username)} · 테스트URL ${esc(meta.targetUrl||'-')}</div>
</header>
<div class="sum">
  <div><b>${steps.length}</b>전체</div>
  <div><b class="ok">${pass}</b>PASS</div>
  <div><b class="warn">${warn}</b>확인필요</div>
  <div><b class="bad">${fail}</b>FAIL</div>
</div>
<main>${rows}</main>
</body></html>`;

  fs.writeFileSync(path.join(outDir,'report.html'), html, 'utf8');
  fs.writeFileSync(path.join(outDir,'report.json'), JSON.stringify({meta,steps},null,2), 'utf8');
  return html;
}

module.exports = buildReport;
