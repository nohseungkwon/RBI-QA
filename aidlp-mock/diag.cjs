#!/usr/bin/env node
/** ③ 질문·답변 로깅 진단 — 격리 세션에서 프롬프트 1건 보내고 LC 콘솔 로그(DlpManager/StreamParser/NETWORK_INTERCEPT)를 수집한다 */
const path = require('path');
const AT = path.resolve(__dirname, '../rbi-autotest');
const cfg = require(path.join(AT, 'lib/config.cjs'));
const S = require(path.join(AT, 'runner/lib/session.cjs'));
const H = require(path.join(AT, 'runner/lib/harness.cjs'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TARGET = process.env.T || 'http://127.0.0.1:8901/chatgpt/';
const TEXT = process.env.TEXT || 'hello diag question';

(async () => {
  const ctx = { cfg, log: console.log, cache: {}, browser: null, outDir: __dirname };
  const iso = await S.isolate(ctx, TARGET, { interact: false, waitMs: 15000 });
  const page = iso.page;
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  for (const f of page.frames()) { /* console 은 page 단위로 전 프레임 수집됨 */ }
  console.log('established', iso.established);
  const rect = await H.surfaceRect(page);
  const vp = { width: rect.w, height: rect.h };
  await H.clickPagePoint(page, rect, vp, 400, 80); await sleep(400);
  await page.keyboard.type(TEXT, { delay: 40 });
  await sleep(300);
  await page.keyboard.press('Enter');
  const t0 = Date.now();
  let toastSeen = null;
  while (Date.now() - t0 < 14000) {
    for (const f of page.frames()) {
      const t = await f.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      const m = t.match(/차단|DLP 정책|개인정보|검사 중/);
      if (m && !toastSeen) toastSeen = `${Date.now() - t0}ms: ${m[0]}`;
    }
    await sleep(250);
  }
  console.log('toast seen:', toastSeen);
  console.log('---- console lines (filtered) ----');
  for (const l of logs) if (/StreamParser|Q&A|audit|aiDlp|DlpManager|error|exception|failed|\[warn|TypeError|ReferenceError/i.test(l) && !/TransactionManager|index\.js\] onStateChange/.test(l)) console.log(l.slice(0, 400));
  console.log('---- total console lines:', logs.length);
  try { await ctx.browser.close(); } catch { }
})().catch(e => { console.error(e); process.exit(2); });
