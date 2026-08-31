/**
 * 반입 차단 출처판별(A+A-3) 시나리오 검증 (2026-08-31)
 * 전제: 적용 정책 = 반출 허용 + 반입 차단 (SCENARIO=B 면 반출·반입 모두 차단 전제)
 * 사용: U=<id> P=<pw> [SCENARIO=A|B] node clipboard-policy-origin-test.cjs
 *
 * SCENARIO A (반출허용+반입차단):
 *  1. 격리 내 복사 → 로컬 클립보드에 반출됨 (해시 확보)
 *  2. 곧바로 붙여넣기 → 격리 출처 → 차단 토스트 없이 V만 전송 (WRITE 없음)
 *  3. 로컬 클립보드를 PC 내용으로 교체 → 붙여넣기 → 완전 차단 (토스트 O, WRITE/V 없음)
 * SCENARIO B (반출·반입 차단, A-3 폴백):
 *  1. 격리 내 복사 (반출 생략됨) → 2. 붙여넣기 → 무조건 차단 토스트
 */
const { chromium } = require('playwright');
const PLAN = require('./testplan');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cfg = {
  domain: (process.env.D || 'https://airrbi.aircode.com').replace(/\/+$/, ''),
  username: process.env.U, password: process.env.P,
  targetUrl: process.env.T || 'http://127.0.0.1:8900',
  scenario: process.env.SCENARIO || 'A',
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const context = await browser.newContext({ viewport: PLAN.VIEWPORT, ignoreHTTPSErrors: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: cfg.domain });
  const page = await context.newPage();
  const firstSel = async (p, cands, t = 10000) => {
    const end = Date.now() + t;
    while (Date.now() < end) {
      for (const sel of cands) { const el = await p.$(sel); if (el && await el.isVisible().catch(() => false)) return sel; }
      await sleep(200);
    }
    throw new Error('selector: ' + cands.join('/'));
  };
  await page.goto(cfg.domain + '/userpage/login/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1200);
  await page.fill(await firstSel(page, PLAN.SEL.loginId), cfg.username);
  await page.fill(await firstSel(page, PLAN.SEL.loginPw), cfg.password);
  await page.click(await firstSel(page, PLAN.SEL.loginBtn));
  await page.waitForURL(/dashboard/, { timeout: 20000 }).catch(() => {});
  await sleep(2500);

  const searchSel = await firstSel(page, PLAN.SEL.search);
  await page.fill(searchSel, cfg.targetUrl);
  let viewer;
  [viewer] = await Promise.all([
    context.waitForEvent('page', { timeout: 20000 }),
    page.press(searchSel, 'Enter'),
  ]);
  await viewer.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(7000);
  const consoleLines = [];
  viewer.on('console', m => { const t = m.text(); if (/Clipboard|CLIPBOARD|sendKeyEvent|keyEvent/i.test(t)) consoleLines.push(t.slice(0, 130)); });
  try { await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(viewer.url()).origin }); } catch {}
  const ui = await (async () => {
    for (const f of viewer.frames()) {
      const has = await f.evaluate(() => !!document.querySelector('#id-rbi-ui-toastPopup')).catch(() => false);
      if (has) return f;
    }
    return viewer.mainFrame();
  })();
  const toastSince = (ms) => (async () => {
    const end = Date.now() + ms; let seen = '';
    while (Date.now() < end) {
      const t = await ui.evaluate(() => { const el = document.querySelector('#id-rbi-ui-toastPopup'); return el ? el.textContent.trim() : ''; }).catch(() => '');
      if (t && !seen.includes(t)) seen += '|' + t;
      await sleep(120);
    }
    return seen;
  })();
  const waitToastClear = async () => {
    for (let k = 0; k < 40; k++) {
      const t = await ui.evaluate(() => { const el = document.querySelector('#id-rbi-ui-toastPopup'); return el ? el.textContent.trim() : ''; }).catch(() => '');
      if (!t) return; await sleep(300);
    }
  };
  const C = PLAN.COORDS;
  const out = { scenario: cfg.scenario, steps: {} };

  // 1) 격리 내 복사
  await viewer.mouse.click(C.copySrc.x, C.copySrc.y); await sleep(500);
  await viewer.keyboard.press('Control+a'); await sleep(150);
  await viewer.keyboard.press('Control+c'); await sleep(2500);
  out.steps.copy = {
    localClipboard: (await viewer.evaluate(() => navigator.clipboard.readText()).catch(() => 'ERR')).slice(0, 50),
    console: consoleLines.splice(0).slice(-4),
  };
  await waitToastClear();

  // 2) 곧바로 붙여넣기 (격리 출처)
  consoleLines.length = 0;
  await viewer.mouse.click(C.pasteDst.x, C.pasteDst.y); await sleep(400);
  const t2 = toastSince(3000);
  await viewer.keyboard.press('Control+v');
  out.steps.pasteInternal = {
    toast: await t2,
    blocked: consoleLines.some(l => l.includes('notifyBlocked')),
    wrote: consoleLines.some(l => l.includes('eventType : 4')),
    console: consoleLines.splice(0).slice(0, 6),
  };
  await waitToastClear();

  // 3) PC 내용으로 교체 후 붙여넣기 (로컬 출처) — 실제 PC 복사는 창 이탈을 동반하므로 blur 이벤트로 재현
  consoleLines.length = 0;
  await ui.evaluate(() => window.dispatchEvent(new Event('blur'))).catch(() => {});
  await viewer.evaluate(() => navigator.clipboard.writeText('PC-ORIGIN-DATA-' + 12345)).catch(() => {});
  await viewer.mouse.click(C.pasteDst.x, C.pasteDst.y); await sleep(400);
  const t3 = toastSince(3000);
  await viewer.keyboard.press('Control+v');
  out.steps.pasteLocal = {
    toast: await t3,
    blocked: consoleLines.some(l => l.includes('notifyBlocked : pasteFromLocal')),
    wrote: consoleLines.some(l => l.includes('eventType : 4')),
    console: consoleLines.splice(0).slice(0, 6),
  };

  console.log('=== ORIGIN TEST RESULT ===');
  console.log(JSON.stringify(out, null, 2));
  await browser.close().catch(() => {});
})();
