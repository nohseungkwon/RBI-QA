#!/usr/bin/env node
/** ③ 진단 2 — NETWORK_INTERCEPT 이벤트의 실제 args 내용과, 차단 시 토스트 타이밍을 본다 */
const path = require('path');
const AT = path.resolve(__dirname, '../rbi-autotest');
const cfg = require(path.join(AT, 'lib/config.cjs'));
const S = require(path.join(AT, 'runner/lib/session.cjs'));
const H = require(path.join(AT, 'runner/lib/harness.cjs'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TARGET = process.env.T || 'http://127.0.0.1:8901/chatgpt/';

(async () => {
  const ctx = { cfg, log: console.log, cache: {}, browser: null, outDir: __dirname };
  const iso = await S.isolate(ctx, TARGET, { interact: false, waitMs: 15000 });
  const page = iso.page;
  const intercepts = [];
  const errors = [];
  page.on('console', async m => {
    const text = m.text();
    if (m.type() === 'error') errors.push(`${text} @ ${m.location() && m.location().url}`);
    if (text.startsWith('[index.js] onStateChange state : networkIntercept') && intercepts.length < 40) {
      try {
        const args = m.args();
        const v = args.length > 1 ? await args[1].jsonValue() : null;
        intercepts.push(v);
      } catch (e) { intercepts.push({ err: e.message }); }
    }
  });
  const rect = await H.surfaceRect(page);
  const vp = { width: rect.w, height: rect.h };

  // 1) 허용 프롬프트 → intercept args 덤프
  await H.clickPagePoint(page, rect, vp, 400, 80); await sleep(400);
  await page.keyboard.type('hello diag two', { delay: 40 }); await sleep(300);
  await page.keyboard.press('Enter');
  await sleep(10000);
  console.log('---- intercept args (first 4) ----');
  for (const v of intercepts) {
    if (!v) { console.log('(null)'); continue; }
    const c = v.args && v.args.content;
    console.log(JSON.stringify({ type: v.type, argKeys: v.args ? Object.keys(v.args) : null, contentType: typeof c,
      contentHead: typeof c === 'string' ? c.slice(0, 60) : JSON.stringify(c).slice(0, 60), contentTail: typeof c === 'string' ? JSON.stringify(c.slice(-16)) : null, len: typeof c === 'string' ? c.length : -1 }));
  }
  console.log('---- resource errors ----'); errors.forEach(e => console.log(e.slice(0, 200)));

  // 2) 차단 프롬프트 → 토스트 타이밍 + 입력 잔존
  await H.clickPagePoint(page, rect, vp, 400, 80); await sleep(400);
  await page.keyboard.press('Control+A'); await page.keyboard.press('Delete');
  await page.keyboard.type('deny diag two', { delay: 40 }); await sleep(300);
  await page.keyboard.press('Enter');
  const t0 = Date.now(); let seen = null;
  while (Date.now() - t0 < 8000) {
    for (const f of page.frames()) {
      const t = await f.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      const m = t.match(/차단[^\n]{0,60}|DLP 정책[^\n]{0,60}|개인정보[^\n]{0,60}/);
      if (m && !seen) { seen = `${Date.now() - t0}ms: ${m[0]}`; await page.screenshot({ path: path.join(__dirname, 'results', 'diag2-toast.png') }); }
    }
    await sleep(150);
  }
  console.log('toast seen:', seen);
  await page.screenshot({ path: path.join(__dirname, 'results', 'diag2-after-block.png') });
  try { await ctx.browser.close(); } catch { }
})().catch(e => { console.error(e); process.exit(2); });
