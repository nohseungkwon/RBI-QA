/**
 * AirRBI 사용자 포털 QA 러너 (Playwright + 시스템 Chrome)
 * 흐름: 로그인 → 대시보드 검색창으로 테스트 타겟 격리실행 → 클립보드/잘라내기/검색/파일보관함/비디오 검증
 * 각 단계마다 "동작 전 / 동작 후" 스크린샷을 results/<YYYYMMDDHHMMSS>/ 에 저장하고 리포트 생성.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const buildReport = require('./report');
const PLAN = require('./testplan');

function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function firstSel(page, candidates, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const sel of candidates) {
      const el = await page.$(sel);
      if (el && await el.isVisible().catch(() => false)) return sel;
    }
    await sleep(200);
  }
  throw new Error('요소를 찾지 못함: ' + candidates.join(' / '));
}

async function runQA(cfg, onProgress = () => {}) {
  const st = stamp();
  const outDir = path.join(__dirname, 'results', st);
  fs.mkdirSync(outDir, { recursive: true });
  const log = m => { onProgress({ type: 'log', message: m }); console.log('[QA]', m); };
  const steps = [];
  const C = PLAN.COORDS, W = PLAN.WAIT;
  const domain = cfg.domain.replace(/\/+$/, '');
  let browser, viewer = null;

  async function snap(target, step, which) {
    const file = `${step.id}_${which}.png`;
    try { await target.screenshot({ path: path.join(outDir, file) }); step[which] = file; }
    catch (e) { log(`스크린샷 실패(${file}): ${e.message}`); }
  }
  const isStopped = () => !!(cfg.control && cfg.control.stopped);
  async function step(id, title, fn) {
    if (isStopped()) { const s = { id, title, status: 'skip', before: null, after: null, note: '사용자 중지' }; steps.push(s); onProgress({ type: 'step-end', step: s }); return s; }
    const s = { id, title, status: 'pass', before: null, after: null, note: '' };
    onProgress({ type: 'step-start', id, title });
    try { await fn(s); }
    catch (e) { s.status = isStopped() ? 'skip' : 'fail'; s.note = (s.note ? s.note + ' | ' : '') + (isStopped() ? '사용자 중지' : '오류: ' + e.message); }
    steps.push(s); onProgress({ type: 'step-end', step: s });
    return s;
  }
  // 격리 뷰어 캔버스 좌표 클릭 + 키 입력 헬퍼
  const click = (x, y) => viewer.mouse.click(x, y);
  const press = k => viewer.keyboard.press(k);

  try {
    log('Chrome 실행…');
    browser = await chromium.launch({ channel: 'chrome', headless: cfg.headless === true });
    if (cfg.control) cfg.control.browser = browser;   // 서버 중지 시 닫기
    const context = await browser.newContext({ viewport: PLAN.VIEWPORT, ignoreHTTPSErrors: true });
    try { await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: domain }); } catch {}
    const page = await context.newPage();

    // ── 01 로그인 ─────────────────────────────
    await step('01_login', '로그인', async s => {
      await page.goto(`${domain}/userpage/login/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(W.render);
      await snap(page, s, 'before');
      const idSel = await firstSel(page, PLAN.SEL.loginId);
      const pwSel = await firstSel(page, PLAN.SEL.loginPw);
      await page.fill(idSel, cfg.username);
      await page.fill(pwSel, cfg.password);
      const btn = await firstSel(page, PLAN.SEL.loginBtn);
      await page.click(btn);
      await page.waitForURL(/dashboard/, { timeout: 20000 }).catch(() => {});
      await sleep(W.afterLogin);
      await snap(page, s, 'after');
      if (!/dashboard/.test(page.url())) { s.status = 'warn'; s.note = '대시보드 URL 미확인 — 계정/도메인 확인 필요'; }
      else s.note = '로그인 성공 → ' + page.url();
    });

    // ── 02 테스트 타겟 격리 실행 ───────────────
    await step('02_launch', '테스트 타겟 격리 실행(검색창)', async s => {
      await snap(page, s, 'before');
      const searchSel = await firstSel(page, PLAN.SEL.search);
      await page.fill(searchSel, cfg.targetUrl);
      let opened = null;
      try {
        [opened] = await Promise.all([
          context.waitForEvent('page', { timeout: 15000 }),
          page.press(searchSel, 'Enter'),
        ]);
      } catch { /* 새 탭이 안 열리면 같은 탭 사용 */ }
      viewer = opened || page;
      await viewer.waitForLoadState('domcontentloaded').catch(() => {});
      await sleep(W.afterLaunch);
      await viewer.bringToFront().catch(() => {});
      await snap(viewer, s, 'after');
      s.note = '격리 세션 URL: ' + viewer.url().slice(0, 90) + '…';
      if (/차단|block/i.test(await viewer.title().catch(() => ''))) { s.status = 'warn'; s.note += ' (차단 페이지 — 화이트리스트/정책 확인)'; }
    });

    // 뷰어가 없으면 이후 단계 스킵
    const guard = async (s) => { if (!viewer) { s.status = 'fail'; s.note = '격리 뷰어 없음'; throw new Error('no viewer'); } };

    // 캔버스에 키보드 포커스 부여(클립보드 단계 시작 전)
    if (viewer) { try { await click(C.copySrc.x, C.copySrc.y); await sleep(400); } catch {} }

    // ── 03 클립보드: copySrc 클릭·전체선택·복사 → pasteDst 클릭·붙여넣기 ──
    await step('03_clipboard', '클립보드 복사 → 붙여넣기', async s => {
      await guard(s);
      await click(C.copySrc.x, C.copySrc.y); await sleep(350);
      await snap(viewer, s, 'before');
      await press('Control+a'); await press('Control+c'); await sleep(300);
      await click(C.pasteDst.x, C.pasteDst.y); await sleep(300);
      await press('Control+v'); await sleep(W.afterAction);
      await snap(viewer, s, 'after');
      s.status = 'warn'; s.note = '붙여넣기 칸에 텍스트가 붙으면 허용/PASS, 비면 클립보드 정책 차단.';
    });

    // ── 04 잘라내기: cutSrc 클릭·전체선택·잘라내기 → cutDst 클릭·붙여넣기 ──
    await step('04_cut', '잘라내기(Cut) → 붙여넣기', async s => {
      await guard(s);
      await click(C.cutSrc.x, C.cutSrc.y); await sleep(350);
      await snap(viewer, s, 'before');
      await press('Control+a'); await press('Control+x'); await sleep(300);
      await click(C.cutDst.x, C.cutDst.y); await sleep(300);
      await press('Control+v'); await sleep(W.afterAction);
      await snap(viewer, s, 'after');
      s.status = 'warn'; s.note = '원본이 비고 대상에 텍스트가 붙으면 PASS.';
    });

    // ── 05 문자열 검색: findInput 클릭 → 검색어 입력 ──
    await step('05_find', '문자열 검색(찾기)', async s => {
      await guard(s);
      await click(C.findInput.x, C.findInput.y); await sleep(350);
      await snap(viewer, s, 'before');
      await viewer.keyboard.type(PLAN.FIND_QUERY, { delay: 90 });
      await sleep(W.afterAction);
      await snap(viewer, s, 'after');
      s.status = 'warn'; s.note = `"${PLAN.FIND_QUERY}" 입력 → 본문 하이라이트·건수 표시되면 PASS.`;
    });

    // ── 06 파일보관함: 텍스트(.txt) 다운로드 버튼 클릭 ──
    await step('06_filebox', '파일보관함(다운로드 + CDR)', async s => {
      await guard(s);
      await snap(viewer, s, 'before');
      await click(C.downloadTxt.x, C.downloadTxt.y);
      await sleep(W.afterAction + 1800);
      await snap(viewer, s, 'after');
      s.status = 'warn'; s.note = '우상단 "파일 보관함 기록(검사중→완료)" 뜨면 PASS.';
    });

    // ── 07 비디오: 스크롤 → before → ▶재생 클릭 → after ──
    await step('07_video', '샘플 비디오 재생', async s => {
      await guard(s);
      await viewer.mouse.move(PLAN.VIEWPORT.width / 2, PLAN.VIEWPORT.height / 2);
      for (let i = 0; i < 5; i++) { await viewer.mouse.wheel(0, 500); await sleep(220); }
      await sleep(W.render);
      await snap(viewer, s, 'before');                   // 재생 전(정지)
      await click(C.videoPlay.x, C.videoPlay.y);
      await sleep(W.afterAction + 2200);                 // 재생
      await snap(viewer, s, 'after');                    // 재생중(경과시간)
      s.status = 'warn'; s.note = '상태에 "▶ 재생중 N.Ns"가 갱신되고 시간이 늘면 PASS.';
    });

    log('완료 — 리포트 생성');
  } catch (e) {
    log('치명적 오류: ' + e.message);
    steps.push({ id: '00_error', title: '실행 오류', status: 'fail', before: null, after: null, note: e.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const meta = { stamp: st, domain: cfg.domain, username: cfg.username, targetUrl: cfg.targetUrl, finishedAt: new Date().toISOString() };
  buildReport(meta, steps, outDir);
  onProgress({ type: 'done', stamp: st, steps });
  return { stamp: st, outDir, steps, meta };
}

module.exports = { runQA };

// CLI: node runner.js <domain> <id> <pw> <targetUrl>
if (require.main === module) {
  const [domain, username, password, targetUrl] = process.argv.slice(2);
  if (!domain || !username || !password) {
    console.log('사용법: node runner.js <도메인> <아이디> <비밀번호> [테스트URL]');
    process.exit(1);
  }
  runQA({ domain, username, password, targetUrl: targetUrl || 'http://193.200.10.116:8900' })
    .then(r => console.log('완료:', r.stamp, '→ results/' + r.stamp + '/report.html'))
    .catch(e => { console.error(e); process.exit(1); });
}
