/**
 * 클립보드 4플래그 정책 E2E 검증 스크립트 (2026-08-31, feat-clipboard-policy-20260831)
 * 사용: D=https://airrbi.aircode.com U=<id> P=<pw> T=http://127.0.0.1:8900 CASE=<라벨> node clipboard-policy-verify.cjs
 * 검증 항목:
 *  1) ig 정책 응답의 clipboardConfig 4플래그 캡처
 *  2) PolicyBox 표기(4행 activated)
 *  3) Ctrl+C 반출: 로컬 클립보드 센티널 덮어쓰기 여부 + 차단 토스트
 *  4) Ctrl+V 반입: 차단 토스트
 *  5) 우클릭 컨텍스트메뉴 복사/붙여넣기 항목 표시 여부
 */
const { chromium } = require('playwright');
const PLAN = require('./testplan');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cfg = {
  domain: (process.env.D || 'https://airrbi.aircode.com').replace(/\/+$/, ''),
  username: process.env.U, password: process.env.P,
  targetUrl: process.env.T || 'http://127.0.0.1:8900',
  label: process.env.CASE || 'case',
};
if (!cfg.username || !cfg.password) { console.error('U/P 환경변수 필요'); process.exit(2); }

(async () => {
  const out = { label: cfg.label, capturedConfig: null, capturedFrom: null, policyBox: null,
    copy: {}, paste: {}, contextMenu: null, errors: [] };
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  try {
    const context = await browser.newContext({ viewport: PLAN.VIEWPORT, ignoreHTTPSErrors: true });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: cfg.domain });

    // 1) 정책 응답 캡처 (모든 응답에서 clipboardConfig 문자열 탐색)
    context.on('response', async (res) => {
      try {
        const ct = (res.headers()['content-type'] || '');
        if (!/json|javascript|text/.test(ct)) return;
        const body = await res.text();
        if (body.includes('clipboardConfig')) {
          const m = body.match(/"clipboardConfig"\s*:\s*("(?:[^"\\]|\\.)*"|null|\{[^}]*\})/);
          if (m) { out.capturedConfig = m[1]; out.capturedFrom = res.url(); }
        }
      } catch (e) {}
    });

    const page = await context.newPage();
    await page.goto(cfg.domain + '/userpage/login/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(PLAN.WAIT.render);
    const firstSel = async (p, cands, t = 8000) => {
      const end = Date.now() + t;
      while (Date.now() < end) {
        for (const sel of cands) { const el = await p.$(sel); if (el && await el.isVisible().catch(() => false)) return sel; }
        await sleep(200);
      }
      throw new Error('selector not found: ' + cands.join('/'));
    };
    await page.fill(await firstSel(page, PLAN.SEL.loginId), cfg.username);
    await page.fill(await firstSel(page, PLAN.SEL.loginPw), cfg.password);
    await page.click(await firstSel(page, PLAN.SEL.loginBtn));
    await page.waitForURL(/dashboard/, { timeout: 20000 }).catch(() => {});
    await sleep(PLAN.WAIT.afterLogin);
    if (!/dashboard/.test(page.url())) out.errors.push('로그인 실패 의심: ' + page.url());

    // 격리 실행
    const searchSel = await firstSel(page, PLAN.SEL.search);
    await page.fill(searchSel, cfg.targetUrl);
    let viewer = null;
    try {
      [viewer] = await Promise.all([
        context.waitForEvent('page', { timeout: 15000 }),
        page.press(searchSel, 'Enter'),
      ]);
    } catch { viewer = page; }
    await viewer.waitForLoadState('domcontentloaded').catch(() => {});
    await sleep(PLAN.WAIT.afterLaunch);
    await viewer.bringToFront().catch(() => {});
    // 클립보드 권한은 뷰어 오리진에도 부여
    try { await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(viewer.url()).origin }); } catch (e) {}

    // UI DOM은 iframe(rbiFrame) 안에 있을 수 있음 — 토스트/정책박스가 보이는 프레임을 찾는다
    const uiFrame = async () => {
      for (const f of viewer.frames()) {
        const has = await f.evaluate(() => !!(document.querySelector('#id-rbi-ui-toastPopup') || document.querySelector('#id-rbi-ui-policybox'))).catch(() => false);
        if (has) return f;
      }
      return viewer.mainFrame();
    };
    const ui = await uiFrame();
    out.uiFrameUrl = ui.url();

    // 콘솔 로그 수집 (ClipboardPolicyManager/CLIPBOARD 관련)
    const consoleLines = [];
    viewer.on('console', m => { const t = m.text(); if (/Clipboard|CLIPBOARD|클립보드/i.test(t)) consoleLines.push(t.slice(0, 160)); });
    out.consoleLines = consoleLines;

    // 2) PolicyBox 표기 판독 — 툴팁에는 '허용된' 정책만 li로 렌더된다
    out.policyBox = await ui.evaluate(() => {
      const tip = document.querySelector('#id-rbi-ui-policybox-tooltip');
      if (!tip) return null;
      return Array.from(tip.querySelectorAll('li')).map(li => li.textContent.trim());
    }).catch(e => { out.errors.push('policyBox: ' + e.message); return null; });

    // 토스트는 잠깐 떴다 사라질 수 있어 폴링으로 첫 비어있지 않은 텍스트를 잡는다
    const watchToast = async (ms = 4000) => {
      const end = Date.now() + ms;
      let seen = '';
      while (Date.now() < end) {
        const t = await ui.evaluate(() => {
          const el = document.querySelector('#id-rbi-ui-toastPopup');
          return el && el.textContent ? el.textContent.trim() : '';
        }).catch(() => '');
        if (t && !seen.includes(t)) seen = seen ? seen + ' | ' + t : t;
        await sleep(150);
      }
      return seen;
    };

    const C = PLAN.COORDS;
    // 캔버스 포커스
    await viewer.mouse.click(C.copySrc.x, C.copySrc.y); await sleep(500);

    // 3) 복사(반출) 검증 — 센티널을 로컬 클립보드에 심고 Ctrl+A/C 후 읽기
    const SENTINEL = 'SENTINEL-' + Date.now();
    await viewer.evaluate(s => navigator.clipboard.writeText(s), SENTINEL).catch(e => out.errors.push('sentinel write: ' + e.message));
    await viewer.mouse.click(C.copySrc.x, C.copySrc.y); await sleep(400);
    await viewer.keyboard.press('Control+a'); await sleep(150);
    const copyToastP = watchToast(3500);
    await viewer.keyboard.press('Control+c');
    out.copy.toast = await copyToastP;
    out.copy.clipboardAfter = await viewer.evaluate(() => navigator.clipboard.readText()).catch(e => 'READ_ERR:' + e.message);
    out.copy.exported = out.copy.clipboardAfter !== SENTINEL && !String(out.copy.clipboardAfter).startsWith('READ_ERR');

    // 이전(복사) 토스트가 사라질 때까지 대기 — 붙여넣기 토스트와 섞이지 않게
    for (let i = 0; i < 40; i++) {
      const t = await ui.evaluate(() => { const el = document.querySelector('#id-rbi-ui-toastPopup'); return el ? el.textContent.trim() : ''; }).catch(() => '');
      if (!t) break; await sleep(300);
    }

    // 4) 붙여넣기(반입) 검증 — 로컬 클립보드에 데이터 넣고 Ctrl+V
    await viewer.evaluate(() => navigator.clipboard.writeText('LOCAL-PASTE-DATA')).catch(() => {});
    await viewer.mouse.click(C.pasteDst.x, C.pasteDst.y); await sleep(400);
    const pasteToastP = watchToast(3500);
    await viewer.keyboard.press('Control+v');
    out.paste.toast = await pasteToastP;

    // 5) 컨텍스트 메뉴 항목 표시 여부
    await viewer.mouse.click(C.copySrc.x, C.copySrc.y, { button: 'right' }); await sleep(1800);
    out.contextMenu = await ui.evaluate(() => {
      const r = {};
      ['copyText', 'cut', 'paste', 'copyLink', 'copyImage'].forEach(id => {
        const el = document.querySelector('#id-rbi-ui-contextmenu-' + id);
        r[id] = el ? el.style.display : 'MISSING';
      });
      const menu = document.querySelector('#id-rbi-ui-contextmenu');
      r._menuVisible = menu ? menu.style.display : 'MISSING';
      return r;
    }).catch(e => ({ error: e.message }));
    await viewer.keyboard.press('Escape').catch(() => {});

    console.log('=== RESULT ' + cfg.label + ' ===');
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    out.errors.push(e.message);
    console.log('=== RESULT(FAILED) ' + cfg.label + ' ===');
    console.log(JSON.stringify(out, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
})();
