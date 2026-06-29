const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await b.newContext({ viewport: { width: 1520, height: 860 } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8950/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800);
  const ids = ['copySrc','pasteDst','cutSrc','cutDst','findInput','btnCopy','btnCut','btnDownTxt','btnPlay','vid','findBody'];
  const o = await p.evaluate((ids) => {
    const r = { iw: innerWidth, ih: innerHeight };
    for (const id of ids) { const e = document.getElementById(id); if (e) { const b = e.getBoundingClientRect(); r[id] = [Math.round(b.left + b.width/2), Math.round(b.top + b.height/2)]; } else r[id] = 'MISSING'; }
    return r;
  }, ids);
  console.log(JSON.stringify(o));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
