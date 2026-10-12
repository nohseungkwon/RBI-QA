/**
 * 클립보드 4플래그 16조합 전수 스윕 (2026-08-31)
 * 사용: U=<id> P=<pw> node clipboard-policy-sweep.cjs
 * 조합마다: DB 세팅 → 격리 재실행 → 복사(반출 센티널)·붙여넣기(콘솔 WRITE/토스트) 실측 → 기대치 대조
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const PLAN = require('./testplan');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cfg = {
  domain: (process.env.D || 'https://airrbi.aircode.com').replace(/\/+$/, ''),
  username: process.env.U, password: process.env.P,
  targetUrl: process.env.T || 'http://127.0.0.1:8900',
};
if (!cfg.username || !cfg.password) { console.error('U/P 필요'); process.exit(2); }

const B = [true, false];
const combos = [];
for (const copy of B) for (const paste of B) for (const cCopy of B) for (const cPaste of B)
  combos.push({ copyAllowed: copy, pasteAllowed: paste, clientCopyAllowed: cCopy, clientPasteAllowed: cPaste });
// START=n 부터 재개 (harness 중단 시 이어서)
const START = parseInt(process.env.START || '0', 10);
if (START > 0) combos.splice(0, START);

function setDb(json) {
  execFileSync('wsl', ['-d', 'Rocky8', '--', 'bash', '-c', `bash /tmp/setcb.sh '${json}'`], { timeout: 30000 });
}

const T_COPY_BLOCK = '격리 브라우저의 복사가 차단';
const T_EXPORT_BLOCK = '격리 브라우저에서 로컬로 복사가 차단';
const T_PASTE_BLOCK = '격리 브라우저의 붙여넣기가 차단';
const T_IMPORT_BLOCK = '로컬에서 격리 브라우저로 붙여넣기가 차단';

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
  console.log('로그인 완료:', page.url());

  const results = [];
  // 격리 대상(test-site)이 죽어 있으면 UG 오류 페이지에서 판정돼 전 조합이 무의미해진다 — 조합마다 사전 확인
  const targetAlive = () => {
    try {
      const out = execFileSync('wsl', ['-d', 'Rocky8', '--', 'bash', '-c', `curl -s -o /dev/null -w '%{http_code}' --max-time 3 ${cfg.targetUrl}/`], { timeout: 15000 }).toString().trim();
      return out === '200';
    } catch (e) { return false; }
  };
  for (let i = 0; i < combos.length; i++) {
    const c = combos[i];
    const label = `copy=${+c.copyAllowed} paste=${+c.pasteAllowed} cCopy=${+c.clientCopyAllowed} cPaste=${+c.clientPasteAllowed}`;
    if (!targetAlive()) {
      console.log(`[${i + 1}/16] ABORT ${label} — 격리 대상 ${cfg.targetUrl} 응답 없음(test-site 죽음). serve.cjs 재기동 후 START=${i + START} 로 재개`);
      results.push({ label, pass: false, note: 'ENV: target down' });
      break;
    }
    setDb(JSON.stringify(c));
    let viewer = null;
    const row = { label, pass: false, note: '' };
    try {
      const searchSel = await firstSel(page, PLAN.SEL.search);
      await page.fill(searchSel, cfg.targetUrl);
      [viewer] = await Promise.all([
        context.waitForEvent('page', { timeout: 20000 }),
        page.press(searchSel, 'Enter'),
      ]);
      await viewer.waitForLoadState('domcontentloaded').catch(() => {});
      await sleep(7000);
      const consoleLines = [];
      viewer.on('console', m => consoleLines.push(m.text()));
      try { await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(viewer.url()).origin }); } catch {}
      const ui = await (async () => {
        for (const f of viewer.frames()) {
          const has = await f.evaluate(() => !!document.querySelector('#id-rbi-ui-toastPopup')).catch(() => false);
          if (has) return f;
        }
        return viewer.mainFrame();
      })();
      const toastSince = async (ms) => {
        const end = Date.now() + ms; let seen = '';
        while (Date.now() < end) {
          const t = await ui.evaluate(() => { const el = document.querySelector('#id-rbi-ui-toastPopup'); return el ? el.textContent.trim() : ''; }).catch(() => '');
          if (t && !seen.includes(t)) seen += '|' + t;
          await sleep(120);
        }
        return seen;
      };
      const C = PLAN.COORDS;
      // ── 복사 검증 (LC 핸들러가 안 탔으면 — 클릭이 캔버스 밖에 떨어진 경우 — 재클릭 1회 재시도)
      let SENT, copyToast, after, exported, copyFired = false;
      for (let attempt = 0; attempt < 2 && !copyFired; attempt++) {
        SENT = 'S-' + i + '-' + Math.floor(Math.random() * 1e6);
        await viewer.evaluate(s => navigator.clipboard.writeText(s), SENT).catch(() => {});
        consoleLines.length = 0;
        await viewer.mouse.click(C.copySrc.x, C.copySrc.y); await sleep(attempt ? 1200 : 350);
        await viewer.keyboard.press('Control+a'); await sleep(120);
        const copyToastP = toastSince(3000);
        await viewer.keyboard.press('Control+c');
        copyToast = await copyToastP;
        copyFired = consoleLines.some(l => l.includes('handleCopyOrCut'));
        after = await viewer.evaluate(() => navigator.clipboard.readText()).catch(() => 'ERR');
        exported = after !== SENT && after !== 'ERR';
        if (!copyFired) await sleep(1500);
      }
      if (!copyFired) row.note += '(copy핸들러 미발화) ';
      // 기대치
      const expExported = c.copyAllowed && c.clientCopyAllowed;
      const expCopyToast = !c.copyAllowed ? T_COPY_BLOCK : (!c.clientCopyAllowed ? T_EXPORT_BLOCK : '');
      let ok = exported === expExported && (expCopyToast === '' ? (!copyToast.includes(T_COPY_BLOCK) && !copyToast.includes(T_EXPORT_BLOCK)) : copyToast.includes(expCopyToast));
      if (!ok) row.note += `copy실패(exported=${exported} exp=${expExported} toast=${copyToast.slice(0, 60)}) `;
      // 복사 토스트 소멸 대기
      for (let k = 0; k < 30; k++) {
        const t = await ui.evaluate(() => { const el = document.querySelector('#id-rbi-ui-toastPopup'); return el ? el.textContent.trim() : ''; }).catch(() => '');
        if (!t) break; await sleep(300);
      }
      // ── 붙여넣기 검증 — PC 복사를 재현: 실제 PC 복사는 창 이탈을 동반하므로 blur 이벤트 후 로컬 클립보드 교체
      //    (출처판별 로직이 "창 이탈 없음=격리 출처"로 보지 않도록). 핸들러 미발화 시 재클릭 1회 재시도
      let pasteToast, wroteToUg, pasteFired = false;
      for (let attempt = 0; attempt < 2 && !pasteFired; attempt++) {
        consoleLines.length = 0;
        await ui.evaluate(() => window.dispatchEvent(new Event('blur'))).catch(() => {});
        await viewer.evaluate(() => navigator.clipboard.writeText('LP-DATA')).catch(() => {});
        await viewer.mouse.click(C.pasteDst.x, C.pasteDst.y); await sleep(attempt ? 1200 : 350);
        const pasteToastP = toastSince(3000);
        await viewer.keyboard.press('Control+v');
        pasteToast = await pasteToastP;
        pasteFired = consoleLines.some(l => l.includes('onpaste'));
        wroteToUg = consoleLines.some(l => l.includes('eventType : 4'));
        if (!pasteFired) await sleep(1500);
      }
      if (!pasteFired) row.note += '(paste핸들러 미발화) ';
      const expWrote = c.pasteAllowed && c.clientPasteAllowed;
      const expPasteToast = !c.pasteAllowed ? T_PASTE_BLOCK : (!c.clientPasteAllowed ? T_IMPORT_BLOCK : '');
      const ok2 = wroteToUg === expWrote && (expPasteToast === '' ? (!pasteToast.includes(T_PASTE_BLOCK) && !pasteToast.includes(T_IMPORT_BLOCK)) : pasteToast.includes(expPasteToast));
      if (!ok2) row.note += `paste실패(wrote=${wroteToUg} exp=${expWrote} toast=${pasteToast.slice(0, 60)})`;
      row.pass = ok && ok2;
    } catch (e) {
      row.note = 'ERR: ' + e.message.slice(0, 80);
    } finally {
      if (viewer) await viewer.close().catch(() => {});
      await sleep(1500);
    }
    console.log(`[${i + 1}/16] ${row.pass ? 'PASS' : 'FAIL'} ${label} ${row.note}`);
    results.push(row);
  }
  const fails = results.filter(r => !r.pass);
  console.log(`\n=== SWEEP 결과: ${results.length - fails.length}/16 PASS ===`);
  fails.forEach(f => console.log('FAIL:', f.label, f.note));
  await browser.close().catch(() => {});
  process.exitCode = fails.length ? 1 : 0;
})();
