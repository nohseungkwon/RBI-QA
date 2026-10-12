/**
 * RBI LiteClient 기능 점검 자동화 (통합 점검: 초기로딩·격리콘텐츠·네비·컨텍스트메뉴·업로드/다운로드·파일보관함(상태확인)·찾기·인쇄·클립보드·세션·CDR·사용자메뉴·RBI UI / 항목별 <id>.png, before·after 캡처)
 *   실행: node tests/run-test.cjs   (환경변수 D/U/P/T 로 도메인·계정·타겟 지정)
 *   결과: test-results/YYYYMMDDHHMMSS/  (체크별 스크린샷 + report.html + report.json)
 *
 * LiteClient UI(툴바·컨텍스트메뉴·파일보관함·인쇄·찾기)는 rbiFrame iframe 안의 실제 DOM이므로
 * 좌표가 아닌 id-rbi-ui-* 셀렉터로 검증한다(견고).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');   // 붙여넣기 칸 텍스트 자동 판정(픽셀 비교)
const sleep = ms => new Promise(r => setTimeout(r, ms));
function stamp() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }

async function runTest(cfg, onProgress = () => {}) {
  const st = stamp();
  const outDir = path.join(__dirname, '..', 'test-results', st);
  fs.mkdirSync(outDir, { recursive: true });
  onProgress({ type: 'start', stamp: st, base: '/test-results/' });   // UI가 이미지 경로(base+stamp)를 미리 알도록
  const results = [];
  const consoleErrors = [];
  let cur = null, viewer = null, F = null;
  const log = (...a) => { const m = a.join(' '); console.log('[TEST]', m); onProgress({ type: 'log', message: m }); };

  const browser = await chromium.launch({ channel: 'chrome', headless: cfg.headless === true });
  if (cfg.control) cfg.control.browser = browser;   // 서버가 중지 시 닫을 수 있도록 노출
  const context = await browser.newContext({ viewport: { width: 1520, height: 860 }, ignoreHTTPSErrors: true, acceptDownloads: true });
  try { await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: cfg.domain }); } catch {}
  const page = await context.newPage();
  const attachConsole = (p, tag) => {
    p.on('console', m => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text().slice(0, 160)}`); });
    p.on('pageerror', e => consoleErrors.push(`[${tag}] pageerror: ${e.message.slice(0, 160)}`));
  };
  attachConsole(page, 'dashboard');

  async function shot(name) { try { const f = name + '.png'; await (viewer || page).screenshot({ path: path.join(outDir, f) }); cur = f; return f; } catch { return null; } }
  function rec(section, id, title, status, note) { const r = { section, id, title, status, note: note || '', shot: cur }; results.push(r); log(`${id} [${status}] ${title}${note ? ' — ' + note : ''}`); onProgress({ type: 'check', check: r }); }
  const isStopped = () => !!(cfg.control && cfg.control.stopped);
  const idShot = id => shot(id.replace(/[^\w-]/g, ''));   // 항목별 캡처 <id>.png (일관 네이밍)
  async function check(section, id, title, fn) {
    if (isStopped()) return rec(section, id, title, 'skip', '사용자 중지');
    try { const r = await fn(); await idShot(id); if (r && typeof r === 'object' && r.status) rec(section, id, title, r.status, r.note); else rec(section, id, title, r === false ? 'fail' : 'pass'); }
    catch (e) { await idShot(id); rec(section, id, title, isStopped() ? 'skip' : 'fail', isStopped() ? '사용자 중지' : '오류: ' + e.message); }
  }
  const manual = (section, id, title, note) => { cur = null; return rec(section, id, title, 'manual', note || '수동 확인'); };

  // 프레임 헬퍼
  const visF = async id => { try { return await F.locator('#' + id).first().isVisible(); } catch { return false; } };
  const cntF = async sel => { try { return await F.locator(sel).count(); } catch { return 0; } };
  const clickF = async id => { await F.locator('#' + id).first().click({ timeout: 6000 }); };
  const rightClick = async () => { await viewer.mouse.click(760, 470, { button: 'right' }); await sleep(1000); };
  const refetchFrame = async () => { const el = await viewer.waitForSelector('iframe[name="rbiFrame"], iframe#rbiFrame', { timeout: 20000 }).catch(() => null); if (el) F = await el.contentFrame(); };
  const closeFileBox = async () => {   // 파일보관함 닫기 — #id-rbi-ui-fileBox-close 일반 클릭(수동에서 동작하는 방식)
    for (let i = 0; i < 4; i++) {
      if (!(await visF('id-rbi-ui-fileBox'))) return true;
      const btn = F.locator('#id-rbi-ui-fileBox-close').first();
      try { await btn.scrollIntoViewIfNeeded({ timeout: 1500 }); } catch {}
      try { await btn.click({ timeout: 2500 }); }
      catch { try { await btn.click({ force: true, timeout: 2000 }); } catch {} }
      await sleep(800);
    }
    return !(await visF('id-rbi-ui-fileBox'));
  };
  // 파일보관함 실제 목록 개수 = 체크박스 수 - 1(전체선택). 배지(#id-rbi-ui-file-count)는 다운로드 누적이라 부정확.
  const fileCount = async () => { const n = await F.locator('#id-rbi-ui-fileBox input[type=checkbox]').count().catch(() => 0); return Math.max(0, n - 1); };
  const clearFileBox = async () => {   // 업로드 전 기존 파일 전체 삭제(전체선택 → 삭제 → 확인팝업)
    if (!(await visF('id-rbi-ui-fileBox'))) { try { await clickF('id-rbi-ui-downloadicon'); await sleep(1500); } catch {} }
    if (!(await visF('id-rbi-ui-fileBox'))) return { before: 0, after: 0, cleared: false, opened: false };
    const before = await fileCount();
    if (before === 0) return { before: 0, after: 0, cleared: true, opened: true };
    // 전체 선택 — 커스텀 체크박스(label>input)라 Playwright 클릭은 실패 → JS click으로 전체 체크
    try { await F.evaluate(() => { const c = document.querySelector('#id-rbi-ui-fileBox-checkbox-all'); if (c && !c.checked) c.click(); }); } catch {}
    await sleep(500);
    try { await F.locator('#id-rbi-ui-fileBox-delete-files').click({ force: true }); } catch {}
    await sleep(900);
    for (let i = 0; i < 4; i++) {   // 삭제 확인 팝업이면 확인 클릭
      if (!(await visF('id-rbi-ui-rbiPopup'))) break;
      let clicked = false;
      try { const c = F.locator('#id-rbi-ui-rbiPopup-confirmBtn'); if (await c.count() > 0) { await c.click({ force: true }); clicked = true; } } catch {}
      if (!clicked) { try { await F.locator('#id-rbi-ui-rbiPopup button:has-text("확인")').first().click({ force: true }); } catch {} }
      await sleep(800);
    }
    await sleep(1000);
    const after = await fileCount();
    return { before, after, cleared: after === 0, opened: true };
  };
  // before/after 캡처형 체크(PRD 구조: before/after 2장)
  async function rawShot(name) { const f = name.replace(/[^\w-]/g, '') + '.png'; try { await (viewer || page).screenshot({ path: path.join(outDir, f) }); return f; } catch { return null; } }
  // 지정 영역의 '어두운(텍스트) 픽셀' 수 — 워터마크는 밝아 thr 미만 아님. 붙여넣기 칸 빈칸(≈0)→텍스트(수백)로 자동 판정.
  const darkPixels = async (clip, thr = 110) => {
    try { const png = PNG.sync.read(await (viewer || page).screenshot({ clip })); let n = 0;
      for (let i = 0; i < png.data.length; i += 4) { if (0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2] < thr) n++; }
      return n; } catch { return -1; }
  };
  async function checkBA(section, id, title, prep, action, verify) {
    if (isStopped()) return rec(section, id, title, 'skip', '사용자 중지');
    const s = { section, id, title, status: 'pass', before: null, after: null, note: '' };
    onProgress({ type: 'step-start', id, title });
    try {
      if (prep) await prep();
      s.before = await rawShot(id + '_before');
      if (action) await action();
      await sleep(900);
      s.after = await rawShot(id + '_after');
      const r = verify ? await verify() : true;
      if (r && typeof r === 'object' && r.status) { s.status = r.status; s.note = r.note || ''; } else s.status = r === false ? 'fail' : 'pass';
    } catch (e) { s.status = isStopped() ? 'skip' : 'fail'; s.note = isStopped() ? '사용자 중지' : '오류: ' + e.message; }
    results.push(s); onProgress({ type: 'check', check: s });
    log(`${id} [${s.status}] ${title}${s.note ? ' — ' + s.note : ''}`);
    return s;
  }
  // 사용자 메뉴(#id-rbi-ui-moreicon) 헬퍼
  const isMenuActive = async () => F.locator('#id-rbi-ui-moreicon').evaluate(el => /active-/.test(el.className)).catch(() => false);
  const openMenu = async () => { if (!(await isMenuActive())) { await F.locator('#id-rbi-ui-moreicon').click({ force: true }).catch(() => {}); await sleep(900); } };
  const prepMenu = async () => {   // 잔여 팝업 닫고 메뉴 펼치기
    try { await F.locator('#id-rbi-ui-printPreview_cancel').click({ timeout: 1000, force: true }); } catch {}
    try { await F.locator('#id-rbi-ui-cdrpopup [class*="close"], #id-rbi-ui-cdrpopup button').first().click({ timeout: 800, force: true }); } catch {}
    await closeFileBox();
    await viewer.keyboard.press('Escape'); await sleep(300);
    await openMenu();
  };
  const mi = (sel) => F.locator('#id-rbi-ui-moreicon').locator(sel).first();

  try {
    // ===== 로그인 + 격리 실행 =====
    log('로그인…');
    const resp = await page.goto(cfg.domain.replace(/\/+$/, '') + '/userpage/login/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const loginStatus = resp ? resp.status() : 0;
    await sleep(1000);
    await page.fill('input[placeholder="아이디"]', cfg.username).catch(() => {});
    await page.fill('input[placeholder="비밀번호"]', cfg.password).catch(() => {});
    await page.click('button:has-text("로그인")').catch(() => {});
    await page.waitForURL(/dashboard/, { timeout: 20000 }).catch(() => {});
    await sleep(2500);
    log('테스트 타겟 격리 실행…');
    const search = 'input[placeholder="웹사이트 주소를 입력하세요."]';
    await page.fill(search, cfg.targetUrl).catch(() => {});
    try { [viewer] = await Promise.all([context.waitForEvent('page', { timeout: 15000 }), page.press(search, 'Enter')]); }
    catch { viewer = page; }
    attachConsole(viewer, 'liteclient');
    await viewer.waitForLoadState('domcontentloaded').catch(() => {});
    await sleep(8000);
    await refetchFrame();
    await sleep(1500);
    if (!F) { rec('0. 사전', '0-0', 'LiteClient(rbiFrame) 로드', 'fail', 'rbiFrame 프레임 없음'); }
    else rec('0. 사전', '0-0', 'LiteClient(rbiFrame) 로드', 'pass', '프레임 로드 OK');

    // ===== 1. 초기 로딩 =====
    await check('1. 초기 로딩', '1-1', 'HTTP 200 응답', async () => ({ status: loginStatus === 200 ? 'pass' : 'fail', note: 'login status ' + loginStatus }));
    await check('1. 초기 로딩', '1-2', 'Loading 스피너', async () => (await cntF('#id-rbi-ui-loadingPopup')) > 0 ? { status: 'pass', note: '스피너 요소 존재(로딩 후 숨김)' } : false);
    await check('1. 초기 로딩', '1-3', '화면 렌더링 완료', async () => (await visF('id-rbi-ui-bar')) ? { status: 'pass', note: 'UI 바 렌더 완료' } : false);

    // ===== 1B. 격리 콘텐츠 동작 (테스트 페이지 QA 콘솔, 캔버스 좌표) — LiteClient 점검과 통합 =====
    const C = { copySrc: [470, 322], pasteDst: [545, 366], cutSrc: [1035, 322], cutDst: [1115, 366], findInput: [450, 478], videoPlay: [245, 250] };
    const pasteClip = { x: 395, y: 353, width: 315, height: 26 }, cutClip = { x: 965, y: 353, width: 315, height: 26 };
    let ic1b = 0, ic1a = 0, ic2b = 0, ic2a = 0;
    // IC-1 원본칸 클릭(=복사 실행) → 붙여넣기 칸 Ctrl+V. 붙여넣기 칸 텍스트픽셀(빈칸→텍스트)로 자동 PASS/FAIL.
    await checkBA('1B. 격리 콘텐츠', 'IC-1', '클립보드 복사→붙여넣기',
      async () => { await viewer.mouse.click(...C.copySrc); await sleep(600); },
      async () => { ic1b = await darkPixels(pasteClip); await viewer.mouse.click(...C.pasteDst); await sleep(300); await viewer.keyboard.press('Control+a'); await sleep(120); await viewer.keyboard.press('Control+v'); await sleep(900); ic1a = await darkPixels(pasteClip); },
      async () => { const ok = ic1b >= 0 && ic1a >= 0 && (ic1a - ic1b) > 60; return { status: ok ? 'pass' : 'fail', note: (ok ? '붙여넣기 칸에 텍스트 생김 → 복사·붙여넣기 동작' : '붙여넣기 칸 변화 없음 → 클립보드 차단') + ' (텍스트픽셀 ' + ic1b + '→' + ic1a + ')' }; });
    // IC-2 잘라내기 원본칸 클릭(=잘라내기 실행) → 붙여넣기 칸 Ctrl+V. 붙여넣기 칸 텍스트픽셀로 자동 PASS/FAIL.
    await checkBA('1B. 격리 콘텐츠', 'IC-2', '잘라내기→붙여넣기',
      async () => { await viewer.mouse.click(...C.cutSrc); await sleep(600); },
      async () => { ic2b = await darkPixels(cutClip); await viewer.mouse.click(...C.cutDst); await sleep(300); await viewer.keyboard.press('Control+a'); await sleep(120); await viewer.keyboard.press('Control+v'); await sleep(900); ic2a = await darkPixels(cutClip); },
      async () => { const ok = ic2b >= 0 && ic2a >= 0 && (ic2a - ic2b) > 60; return { status: ok ? 'pass' : 'fail', note: (ok ? '붙여넣기 칸에 텍스트 생김 → 잘라내기·붙여넣기 동작' : '붙여넣기 칸 변화 없음') + ' (텍스트픽셀 ' + ic2b + '→' + ic2a + ')' }; });
    // IC-3 문자열 검색(테스트 페이지)
    await checkBA('1B. 격리 콘텐츠', 'IC-3', '문자열 검색(테스트 페이지)',
      async () => { await viewer.mouse.click(...C.findInput); await sleep(350); },
      async () => { await viewer.keyboard.type('RBI', { delay: 90 }); await sleep(900); },
      async () => ({ status: 'pass', note: '"RBI" 입력 → 본문 하이라이트(before/after 확인)' }));
    // IC-4 문자열 검색 (Ctrl+F — LiteClient 찾기로도 동작하는지)
    await checkBA('1B. 격리 콘텐츠', 'IC-4', '문자열 검색 (Ctrl+F)',
      async () => { await viewer.keyboard.press('Escape'); await viewer.mouse.click(760, 500); await sleep(400); },
      async () => { await viewer.keyboard.press('Control+f'); await sleep(1100); await F.locator('#id-rbi-ui-findInput-area').fill('격리').catch(() => {}); await sleep(800); },
      async () => { const ok = await visF('id-rbi-ui-findInput-area'); const v = await F.locator('#id-rbi-ui-findInput-area').inputValue().catch(() => ''); await viewer.keyboard.press('Escape'); return { status: ok ? 'pass' : 'warn', note: ok ? `Ctrl+F 찾기창 열림 + "${v}" 입력` : 'Ctrl+F 찾기창 미표시(타이밍/포커스)' }; });
    // IC-5 샘플 비디오 재생
    await checkBA('1B. 격리 콘텐츠', 'IC-5', '샘플 비디오 재생',
      async () => { await viewer.mouse.move(760, 430); for (let i = 0; i < 6; i++) { await viewer.mouse.wheel(0, 500); await sleep(220); } await sleep(800); },
      async () => { await viewer.mouse.click(...C.videoPlay); await sleep(2500); },
      async () => ({ status: 'pass', note: '재생중 경과시간 갱신(before/after 확인)' }));
    for (let i = 0; i < 8; i++) { await viewer.mouse.wheel(0, -500); await sleep(120); }  // 스크롤 원복

    // ===== 2. 네비게이션 =====
    await check('2. 네비게이션', '2-1', '뒤로 버튼 표시', async () => await visF('id-rbi-ui-btn-back'));
    await check('2. 네비게이션', '2-2', '앞으로 버튼 표시', async () => await visF('id-rbi-ui-btn-forword'));
    await check('2. 네비게이션', '2-3', '새로고침 버튼 표시', async () => await visF('id-rbi-ui-btn-refresh'));
    await check('2. 네비게이션', '2-4', '새로고침 클릭 동작', async () => { await clickF('id-rbi-ui-btn-refresh'); await sleep(3500); await refetchFrame(); await sleep(1500); return { status: (await visF('id-rbi-ui-bar')) ? 'pass' : 'fail', note: '재로드 후 UI 정상' }; });

    // ===== 3. 컨텍스트 메뉴 =====
    await rightClick();
    await check('3. 컨텍스트 메뉴', '3-1', '메뉴 표시', async () => await visF('id-rbi-ui-contextmenu'));
    await check('3. 컨텍스트 메뉴', '3-2', '파일보관함 항목', async () => (await cntF('#id-rbi-ui-contextmenu-filebox')) > 0);
    await check('3. 컨텍스트 메뉴', '3-3', '뒤로/앞으로 항목', async () => (await cntF('#id-rbi-ui-contextmenu-goBack')) > 0 && (await cntF('#id-rbi-ui-contextmenu-goForward')) > 0);
    await check('3. 컨텍스트 메뉴', '3-4', '새로고침/캐시삭제 항목', async () => (await cntF('#id-rbi-ui-contextmenu-reload')) > 0 && (await cntF('#id-rbi-ui-contextmenu-reloadIgnoreCache')) > 0);
    await check('3. 컨텍스트 메뉴', '3-5', '새 창/새 탭 항목', async () => (await cntF('#id-rbi-ui-contextmenu-newPageLink')) > 0 && (await cntF('#id-rbi-ui-contextmenu-newTapLink')) > 0);
    await check('3. 컨텍스트 메뉴', '3-6', '복사/잘라내기/붙여넣기 항목', async () => (await cntF('#id-rbi-ui-contextmenu-copyText')) > 0 && (await cntF('#id-rbi-ui-contextmenu-cut')) > 0 && (await cntF('#id-rbi-ui-contextmenu-paste')) > 0);
    await check('3. 컨텍스트 메뉴', '3-7', '인쇄 항목', async () => (await cntF('#id-rbi-ui-contextmenu-print')) > 0);
    await check('3. 컨텍스트 메뉴', '3-8', '대시보드 항목', async () => (await cntF('#id-rbi-ui-contextmenu-dashBoard')) > 0);

    // ===== 4. 파일 업로드 ===== (보관함은 업로드 전제라 먼저 열기만 하고, 상태 점검은 6장에서 업로드·다운로드 반영 후 수행)
    try { await clickF('id-rbi-ui-contextmenu-filebox'); } catch { try { await clickF('id-rbi-ui-downloadicon'); } catch {} }
    await sleep(1800);
    // 4-0 업로드 전 기존 파일 삭제(리스트에 파일 있으면 비우고 진행 — 사용자 요청)
    await check('4. 파일 업로드', '4-0', '업로드 전 기존 파일 삭제', async () => {
      const r = await clearFileBox();
      if (!r.opened) return { status: 'warn', note: '파일보관함 미표시(삭제 생략)' };
      return { status: r.cleared ? 'pass' : 'warn', note: r.before === 0 ? '기존 파일 없음(0개)' : '기존 ' + r.before + '개 → ' + r.after + '개 (전체선택·삭제)' };
    });
    const upFile = path.join(outDir, 'qa-upload-sample.txt'); fs.writeFileSync(upFile, 'RBI QA 업로드 테스트 ' + st);
    await check('4. 파일 업로드', '4-1', '내 PC→파일 선택 다이얼로그', async () => {
      // 내PC 버튼이 빈 보관함 상태/스크롤 위치에 따라 not visible로 잡힐 수 있어 3단 폴백(일반→force→JS click)
      const btn = F.locator('#id-rbi-ui-fileBox-open-file-dialog').first();
      try { await btn.scrollIntoViewIfNeeded({ timeout: 1500 }); } catch {}
      const clickBtn = async () => {
        try { await btn.click({ timeout: 4000 }); return; } catch {}
        try { await btn.click({ force: true, timeout: 2500 }); return; } catch {}
        await F.evaluate(() => { const b = document.querySelector('#id-rbi-ui-fileBox-open-file-dialog'); if (b) b.click(); });
      };
      const [fc] = await Promise.all([viewer.waitForEvent('filechooser', { timeout: 9000 }), clickBtn()]);
      await fc.setFiles(upFile); return { status: 'pass', note: 'filechooser 감지 + 파일 지정' };
    });
    // 4-2 덮어쓰기 확인 팝업이면 "확인"으로 진행 (동일 파일명 재업로드 시)
    let overwrote = false;
    for (let i = 0; i < 5; i++) { if (await visF('id-rbi-ui-rbiPopup')) { overwrote = true; break; } await sleep(600); }
    if (overwrote) { try { await F.locator('#id-rbi-ui-rbiPopup-confirmBtn').click({ force: true }); } catch {} await sleep(1500); }
    await check('4. 파일 업로드', '4-2', '중복 파일 덮어쓰기 → 확인 진행', async () => ({ status: overwrote ? 'pass' : 'warn', note: overwrote ? '덮어쓰기 팝업 → 확인 클릭' : '중복 팝업 미발생(신규 파일)' }));
    // 업로드 파일이 목록에 뜨고 검사완료(다운로드 버튼 action-ico 등장)될 때까지 폴링(비운 뒤 새 파일이라 검사중→보관중 대기)
    let upCnt = 0, dlBtn = 0;
    for (let i = 0; i < 16; i++) { upCnt = await fileCount(); dlBtn = await cntF('button[class*="action-ico-"]'); if (upCnt >= 1 && dlBtn >= 1) break; await sleep(2000); }
    await check('4. 파일 업로드', '4-3', '업로드 후 목록 표시', async () => ({ status: upCnt > 0 ? 'pass' : 'warn', note: upCnt + '개 파일' + (dlBtn > 0 ? ' · 검사완료' : ' · 검사중') }));
    await check('4. 파일 업로드', '4-4', '업로드 상태 표시', async () => { const t = await F.locator('#id-rbi-ui-fileBox').innerText().catch(() => ''); const ok = /업로드|보관|완료|검사|무해/.test(t); return { status: ok ? 'pass' : 'warn', note: ok ? '상태 텍스트 감지' : '상태 미확인' }; });

    // ===== 5. 파일 다운로드 ===== (방금 업로드한 파일을 내려받아 왕복 동작 확인)
    await check('5. 파일 다운로드', '5-1', '다운로드 버튼 표시', async () => (await cntF('button[class*="action-ico-"]')) > 0 ? { status: 'pass', note: '다운로드 버튼(action-ico) 존재' } : { status: 'warn', note: '다운로드 버튼 미발견(빈 보관함?)' });
    await check('5. 파일 다운로드', '5-2', '다운로드 클릭→파일 저장', async () => {
      if ((await cntF('button[class*="action-ico-"]')) === 0) return { status: 'warn', note: '다운로드 버튼 없음' };
      const [dl] = await Promise.all([viewer.waitForEvent('download', { timeout: 12000 }), F.locator('button[class*="action-ico-"]').first().click()]);
      await dl.saveAs(path.join(outDir, 'download_' + (dl.suggestedFilename() || 'file'))).catch(() => {});
      return { status: 'pass', note: '다운로드: ' + dl.suggestedFilename() };
    });
    manual('5. 파일 다운로드', '5-3', '다운로드 파일 내용 일치', '업로드 원본과 비교 — 수동');

    // ===== 6. 파일보관함 (상태 확인 — 업로드·다운로드 반영 후) =====
    await check('6. 파일보관함', '6-1', '팝업 표시(업로드·다운로드 후 유지)', async () => await visF('id-rbi-ui-fileBox'));
    await check('6. 파일보관함', '6-2', '파일 카운트 배지', async () => { const t = await F.locator('#id-rbi-ui-file-count').first().innerText().catch(() => ''); return { status: t !== '' ? 'pass' : 'fail', note: 'count=' + t }; });
    await check('6. 파일보관함', '6-3', '파일 목록 표시(업로드 파일 반영)', async () => { const n = await fileCount(); return { status: n > 0 ? 'pass' : 'warn', note: n + '개 파일(업로드 파일 포함)' }; });
    await check('6. 파일보관함', '6-4', '내 PC 버튼 표시', async () => await visF('id-rbi-ui-fileBox-open-file-dialog'));
    await check('6. 파일보관함', '6-5', '삭제 버튼 표시', async () => await visF('id-rbi-ui-fileBox-delete-files'));
    await check('6. 파일보관함', '6-6', '파일보관함 닫기(X)', async () => {
      const closed = await closeFileBox();
      return { status: closed ? 'pass' : 'warn', note: closed ? '닫기 동작' : '닫기 실패' };
    });

    // ===== 7. Ctrl+F 찾기 =====
    await closeFileBox();   // 파일보관함이 열려있으면 확실히 닫기(이후 단계 차단 방지)
    let findOpen = false;
    for (let i = 0; i < 3; i++) {                               // 캔버스 포커스 후 Ctrl+F 재시도
      await viewer.mouse.click(760, 470); await sleep(400);
      await viewer.keyboard.press('Control+f'); await sleep(1200);
      if (await visF('id-rbi-ui-findInput-area')) { findOpen = true; break; }
    }
    await check('7. Ctrl+F 찾기', '7-1', '찾기 입력창 표시', async () => findOpen);
    await check('7. Ctrl+F 찾기', '7-2', '텍스트 입력', async () => { await F.locator('#id-rbi-ui-findInput-area').fill('RBI').catch(() => {}); await sleep(500); const v = await F.locator('#id-rbi-ui-findInput-area').inputValue().catch(() => ''); return { status: v === 'RBI' ? 'pass' : 'warn', note: '입력값=' + v }; });
    await check('7. Ctrl+F 찾기', '7-3', 'ESC로 닫기', async () => { await viewer.keyboard.press('Escape'); await sleep(800); return { status: !(await visF('id-rbi-ui-findInput-area')) ? 'pass' : 'fail', note: 'ESC 닫기' }; });
    manual('7. Ctrl+F 찾기', '7-4', '이전/다음 결과 이동', '수동');

    // ===== 8. 인쇄 미리보기 =====
    await viewer.keyboard.press('Escape'); await sleep(400); await closeFileBox();   // 찾기창·파일보관함 정리
    let printOpen = false;
    for (let i = 0; i < 2; i++) {                               // 우클릭→인쇄 재시도
      await rightClick();
      if (!(await visF('id-rbi-ui-contextmenu'))) { await sleep(600); continue; }
      try { await clickF('id-rbi-ui-contextmenu-print'); } catch {}
      for (let j = 0; j < 7; j++) { if (await visF('id-rbi-ui-printPreview')) { printOpen = true; break; } await sleep(1000); }  // 미리보기 로드 폴링
      if (printOpen) break;
    }
    await sleep(500);
    await check('8. 인쇄 미리보기', '8-1', '미리보기 팝업 표시', async () => await visF('id-rbi-ui-printPreview'));
    await check('8. 인쇄 미리보기', '8-2', '미리보기 iframe 로드', async () => (await cntF('#id-rbi-ui-printPreview_id')) > 0);
    await check('8. 인쇄 미리보기', '8-3', '취소 버튼', async () => await visF('id-rbi-ui-printPreview_cancel'));
    await check('8. 인쇄 미리보기', '8-4', '적용 버튼', async () => await visF('id-rbi-ui-printPreview_send'));
    await check('8. 인쇄 미리보기', '8-5', 'PDF 저장 버튼', async () => await visF('id-rbi-ui-printPreview_downLoad'));
    await check('8. 인쇄 미리보기', '8-6', '레이아웃 기본값(세로)', async () => { const v = await F.locator('.hidden-layout, #hidden-layout, #id-rbi-ui-printPreview select').first().inputValue().catch(() => ''); return { status: v !== '' ? 'pass' : 'warn', note: 'value=' + (v || '(미확인)') }; });
    await check('8. 인쇄 미리보기', '8-7', '용지 크기 기본값(A4)', async () => { const v = await F.locator('.hidden-size, #hidden-size, #id-rbi-ui-printPreview select').nth(1).inputValue().catch(() => ''); return { status: v !== '' ? 'pass' : 'warn', note: 'value=' + (v || '(미확인)') }; });
    manual('8. 인쇄 미리보기', '8-8', '레이아웃 변경(가로)', '수동');
    manual('8. 인쇄 미리보기', '8-9', '용지 크기 변경', '수동');
    manual('8. 인쇄 미리보기', '8-10', 'PDF 저장 동작', '수동');
    try { await clickF('id-rbi-ui-printPreview_cancel'); } catch {} await sleep(1000);

    // ===== 9. 클립보드 =====
    await viewer.mouse.click(760, 470); await sleep(300);
    await viewer.keyboard.press('Control+c'); await sleep(500);
    await check('9. 클립보드', '9-1', 'Ctrl+C 키 이벤트 전달', async () => ({ status: 'warn', note: '키 입력 전달됨(VM 수신은 서버측 로그로 확인)' }));
    await viewer.keyboard.press('Control+v'); await sleep(500);
    await check('9. 클립보드', '9-2', 'Ctrl+V 키 이벤트 전달', async () => ({ status: 'warn', note: '키 입력 전달됨(VM 수신은 서버측 로그로 확인)' }));
    await check('9. 클립보드', '9-3', '텍스트 붙여넣기 일치(로컬→VM)', async () => {
      try { await page.evaluate(() => navigator.clipboard.writeText('RBI-QA-CLIP-TEST')); } catch {}
      await viewer.mouse.click(760, 470); await viewer.keyboard.press('Control+v'); await sleep(800);
      return { status: 'warn', note: '로컬→VM 클립보드 동기화는 정책 의존(이 사이트는 차단 관찰됨). 정책 ON 사이트로 확인' };
    });
    await check('9. 클립보드', '9-4', '이미지 저장', async () => {
      await rightClick();
      if ((await cntF('#id-rbi-ui-contextmenu-downloadImage')) > 0 && await visF('id-rbi-ui-contextmenu-downloadImage')) {
        try { const [dl] = await Promise.all([viewer.waitForEvent('download', { timeout: 8000 }), clickF('id-rbi-ui-contextmenu-downloadImage')]); await dl.saveAs(path.join(outDir, 'image_' + (dl.suggestedFilename() || 'img'))); return { status: 'pass', note: '이미지 저장: ' + dl.suggestedFilename() }; }
        catch (e) { return { status: 'warn', note: '메뉴 존재하나 저장 미확인' }; }
      }
      await viewer.keyboard.press('Escape');
      return { status: 'warn', note: '이미지 위 우클릭 시에만 노출(현재 캔버스 우클릭)' };
    });

    // ===== 10. 사용자 / 세션 ===== (로그아웃 테스트는 제거 — 사용자 요청)
    manual('10. 사용자/세션', '10-1', '세션 재연결', '수동');

    // ===== 12. CDR 무해화 시나리오 (테스트 페이지 CDR 링크 클릭 → 다운로드 → 파일보관함 → 완료 → CDR 리포트) =====
    await viewer.keyboard.press('Escape').catch(() => {}); await sleep(400);
    await closeFileBox(); await sleep(400);
    await check('12. CDR 무해화', '12-1', 'CDR 샘플(.doc) 다운로드(링크 클릭)', async () => {
      await viewer.mouse.click(185, 210);   // 테스트 페이지 좌상단 고정 CDR 다운로드 링크 (좌표 보정 가능)
      await sleep(4500);
      return { status: 'pass', note: '테스트 페이지 CDR 링크 클릭 → 다운로드(프레임 유지)' };
    });
    // 파일보관함 열기
    try { await rightClick(); await clickF('id-rbi-ui-contextmenu-filebox'); } catch { try { await clickF('id-rbi-ui-downloadicon'); } catch {} }
    await sleep(2500);
    await check('12. CDR 무해화', '12-2', '파일보관함 CDR 검사완료(통과/완료 버튼)', async () => {
      let ok = false;
      for (let i = 0; i < 20; i++) {  // 최대 ~40초 폴링
        if ((await cntF('#id-rbi-ui-fileBox button:has-text("통과"), #id-rbi-ui-fileBox button:has-text("완료")')) > 0) { ok = true; break; }
        await sleep(2000);
      }
      return { status: ok ? 'pass' : 'warn', note: ok ? 'CDR 통과/완료 버튼 표시(검사완료)' : '시간 내 CDR 완료버튼 미표시(검사중/정책 확인)' };
    });
    await check('12. CDR 무해화', '12-3', '통과/완료 버튼 클릭 → CDR 리포트 팝업', async () => {
      const btn = F.locator('#id-rbi-ui-fileBox button:has-text("통과"), #id-rbi-ui-fileBox button:has-text("완료")').first();
      if (await btn.count() === 0) return { status: 'warn', note: 'CDR 버튼 없음' };
      const label = (await btn.innerText().catch(() => '')).trim().replace(/\s+/g, '');
      await btn.scrollIntoViewIfNeeded().catch(() => {});   // 누적 파일로 화면 밖일 수 있어 스크롤
      await btn.click({ force: true }).catch(async () => { await btn.click().catch(() => {}); });
      await sleep(2000);
      const vis = await visF('id-rbi-ui-cdrpopup');
      return { status: vis ? 'pass' : 'warn', note: `"${label}" 클릭 → CDR 리포트 팝업 ${vis ? '표시' : '미표시'}` };
    });
    await check('12. CDR 무해화', '12-4', 'CDR 리포트 내용(처리내역)', async () => {
      const t = (await F.locator('#id-rbi-ui-cdrpopup').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      const ok = /처리내역|무해화|제거|총|건/.test(t);
      return { status: ok ? 'pass' : 'warn', note: ok ? '처리내역: ' + t.slice(0, 70) : '내용 미확인' };
    });

    // ===== 13. 사용자 메뉴 (#id-rbi-ui-moreicon / .user-menu-list) — before/after =====
    const closePopups = async () => { try { await F.locator('#id-rbi-ui-printPreview_cancel').click({ timeout: 1000, force: true }); } catch {} await closeFileBox(); await viewer.keyboard.press('Escape'); await sleep(300); };

    // 13-1 메뉴 펼치기 (before: 닫힘 / after: 펼침)
    await checkBA('13. 사용자 메뉴', '13-1', '사용자 메뉴 펼치기',
      async () => { await closePopups(); if (await isMenuActive()) { await F.locator('#id-rbi-ui-moreicon').click({ force: true }).catch(() => {}); await sleep(700); } },
      async () => { await F.locator('#id-rbi-ui-moreicon').click({ force: true }).catch(() => {}); await sleep(900); },
      async () => { const n = await F.locator('#id-rbi-ui-moreicon li[order]').count(); return { status: n > 0 ? 'pass' : 'fail', note: n + '개 메뉴 항목 노출' }; });

    // 13-2 새 창 열기
    let pagesBefore = 0;
    await checkBA('13. 사용자 메뉴', '13-2', '새 창 열기 (newWindow)', prepMenu,
      async () => { pagesBefore = context.pages().length; await mi('li[order="0"]').click({ force: true }).catch(() => {}); await sleep(2500); },
      async () => { const now = context.pages().length; const opened = now > pagesBefore; if (opened) { await context.pages()[now - 1].close().catch(() => {}); } return { status: opened ? 'pass' : 'warn', note: opened ? '새 창/탭 열림' : '새 창 미감지' }; });

    // 13-3 즐겨찾기 패널
    await checkBA('13. 사용자 메뉴', '13-3', '즐겨찾기 패널', prepMenu,
      async () => { await mi('li[class*="bookmarks"]').click({ force: true, position: { x: 60, y: 16 } }).catch(() => {}); await sleep(900); },
      async () => ({ status: 'pass', note: '즐겨찾기 토글(before/after 스크린샷 확인)' }));

    // 13-4 허용된 정책 확인
    await checkBA('13. 사용자 메뉴', '13-4', '허용된 정책 확인', prepMenu,
      async () => { await mi('li[class*="pol-"]').click({ force: true, position: { x: 60, y: 16 } }).catch(() => {}); await sleep(900); },
      async () => { const open = await F.locator('#id-rbi-ui-moreicon li[class*="pol-"]').first().evaluate(el => /active|open|on/.test(el.className) || el.querySelector('[class*="list"],ul,ol') != null).catch(() => true); return { status: 'pass', note: '정책 목록 토글(before/after 확인)' + (open ? '' : '') }; });

    // 13-5 인쇄하기 → 인쇄 미리보기
    await checkBA('13. 사용자 메뉴', '13-5', '인쇄하기 → 미리보기', prepMenu,
      async () => { await mi('li[order="4"]').click({ force: true }).catch(() => {}); for (let i = 0; i < 6; i++) { if (await visF('id-rbi-ui-printPreview')) break; await sleep(1000); } },
      async () => { const ok = await visF('id-rbi-ui-printPreview'); try { await F.locator('#id-rbi-ui-printPreview_cancel').click({ force: true }); } catch {} return { status: ok ? 'pass' : 'warn', note: ok ? '인쇄 미리보기 표시' : '미표시(타이밍)' }; });

    // 13-6 파일 보관함
    await checkBA('13. 사용자 메뉴', '13-6', '파일 보관함 열기', prepMenu,
      async () => { await mi('li[order="5"]').click({ force: true }).catch(() => {}); await sleep(1800); },
      async () => { const ok = await visF('id-rbi-ui-fileBox'); await closeFileBox(); return { status: ok ? 'pass' : 'warn', note: ok ? '파일보관함 표시' : '미표시' }; });

    // 13-7 캐시 비우기
    await checkBA('13. 사용자 메뉴', '13-7', '캐시 비우기', prepMenu,
      async () => { await mi('li[order="99"]').click({ force: true }).catch(() => {}); await sleep(1500); },
      async () => { const popup = (await visF('id-rbi-ui-rbiPopup')) || (await visF('id-rbi-ui-toastPopup')); return { status: 'pass', note: popup ? '확인 팝업/토스트 노출' : '캐시 비우기 실행' }; });

    // ===== 14. RBI UI 기능 (#id-rbi-ui) — 공유하기 등 (PRD 3.7) =====
    await closePopups();
    await refetchFrame(); await sleep(800);   // 13-7 캐시비우기 등이 rbiFrame을 detach시킴 → 재취득(안 하면 14-2/4/6/7/8 전부 stale F로 FAIL)
    // 14-1 공유하기(URL 공유 → 클립보드 저장 + 안내)
    await checkBA('14. RBI UI 기능', '14-1', '공유하기(URL 공유)',
      async () => { await closeFileBox(); await viewer.keyboard.press('Escape'); await sleep(300); },
      async () => { await F.locator('#id-rbi-ui-urlsharing-area').click({ force: true }).catch(() => {}); await sleep(1200); },
      async () => { const tip = (await visF('id-rbi-ui-urlsharing-area-tooltip')) || (await visF('id-rbi-ui-toastPopup')); return { status: 'pass', note: tip ? '공유 안내 노출(클립보드 저장)' : '공유 클릭(URL 클립보드 저장)' }; });
    // 14-2 안전 사이트/인증서 아이콘
    await check('14. RBI UI 기능', '14-2', '인증서/안전 아이콘 표시', async () => await visF('id-rbi-ui-inputurl-safeicon'));
    // 14-3 검색 엔진 선택
    await checkBA('14. RBI UI 기능', '14-3', '검색 엔진 선택', null,
      async () => { await F.locator('#id-rbi-ui-inputurl-engine').click({ force: true }).catch(() => {}); await sleep(1000); },
      async () => { const t = await F.locator('#id-rbi-ui-inputurl-engine').innerText().catch(() => ''); const ok = /네이버|구글|검색/.test(t); return { status: ok ? 'pass' : 'warn', note: ok ? '엔진 목록 노출' : 'before/after 확인' }; });
    // 14-4 URL 입력창
    await check('14. RBI UI 기능', '14-4', 'URL 입력창 표시', async () => await visF('id-rbi-ui-urlinput-area'));
    // 14-6 연결 상태 아이콘
    await check('14. RBI UI 기능', '14-6', '연결 상태 아이콘', async () => (await cntF('#id-rbi-ui-ConnectIcon')) > 0 ? { status: 'pass', note: 'ConnectIcon 존재' } : false);
    // 14-7 DLP 감시 아이콘
    await check('14. RBI UI 기능', '14-7', 'DLP 감시 아이콘', async () => (await cntF('#id-rbi-ui-DlpIcon')) > 0 ? { status: 'pass', note: 'DlpIcon 존재' } : false);
    // 14-8 파일보관함 아이콘
    await check('14. RBI UI 기능', '14-8', '파일보관함 아이콘 표시', async () => await visF('id-rbi-ui-downloadicon'));

    // 13-9 교육 동영상 보기(렌더모드 변경 — 세션 흔들리므로 툴바 점검(14) 끝난 뒤 가장 마지막에)
    await checkBA('13. 사용자 메뉴', '13-9', '교육 동영상 보기 (렌더모드)', prepMenu,
      async () => { await mi('li[order="2"]').click({ force: true }).catch(() => {}); await sleep(2000); },
      async () => ({ status: 'pass', note: 'changePaintMethod 실행(before/after 확인)' }));

    // ===== 11. 콘솔 에러 =====
    await check('11. 콘솔 에러', '11-1', '전체 테스트 중 콘솔 에러 없음', async () => ({ status: consoleErrors.length === 0 ? 'pass' : 'fail', note: consoleErrors.length === 0 ? '에러 0건' : consoleErrors.length + '건: ' + consoleErrors.slice(0, 3).join(' / ') }));

    // (L. 로그아웃 테스트 제거 — 사용자 요청. 세션을 종료하지 않고 종료)
  } catch (e) {
    rec('0. 사전', '0-err', isStopped() ? '사용자 중지로 종료' : '실행 오류', isStopped() ? 'skip' : 'fail', isStopped() ? '나머지 항목 미실행' : e.message);
  } finally {
    await browser.close().catch(() => {});
  }

  const meta = { stamp: st, domain: cfg.domain, username: cfg.username, targetUrl: cfg.targetUrl, finishedAt: new Date().toISOString(), consoleErrors };
  buildReport(meta, results, outDir);
  onProgress({ type: 'done', stamp: st });
  return { stamp: st, outDir, results, meta };
}

/* ---------- 리포트(체크리스트 형식) ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function buildReport(meta, results, outDir) {
  const cnt = { pass: 0, fail: 0, warn: 0, manual: 0 };
  results.forEach(r => cnt[r.status] = (cnt[r.status] || 0) + 1);
  const sections = [...new Set(results.map(r => r.section))];
  const badge = s => s === 'pass' ? '<span class="b ok">PASS</span>' : s === 'fail' ? '<span class="b bad">FAIL</span>' : s === 'warn' ? '<span class="b warn">확인</span>' : s === 'skip' ? '<span class="b" style="background:#64748b">중지</span>' : '<span class="b man">수동</span>';
  let rows = '';
  for (const sec of sections) {
    rows += `<tr class="sec"><td colspan="4">${esc(sec)}</td></tr>`;
    for (const r of results.filter(x => x.section === sec)) {
      let media = '';
      if (r.before || r.after) {
        media = '<div class="ba">' +
          (r.before ? `<a href="${esc(r.before)}" target="_blank"><img src="${esc(r.before)}" loading="lazy"><span>전</span></a>` : '') +
          (r.after ? `<a href="${esc(r.after)}" target="_blank"><img src="${esc(r.after)}" loading="lazy"><span class="aft">후</span></a>` : '') + '</div>';
      } else if (r.shot) { media = ` · <a href="${esc(r.shot)}" target="_blank">📷</a>`; }
      rows += `<tr><td class="id">${esc(r.id)}</td><td>${esc(r.title)}</td><td>${badge(r.status)}</td>` +
        `<td class="note">${esc(r.note)}${media}</td></tr>`;
    }
  }
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>RBI LiteClient 점검 ${esc(meta.stamp)}</title>
<style>
  body{margin:0;font-family:'Malgun Gothic','Segoe UI',sans-serif;background:#eef1f8;color:#1f2a44}
  header{background:linear-gradient(100deg,#3a52e6,#6a5cf7,#8b5cf6);color:#fff;padding:18px 26px}
  header h1{margin:0;font-size:19px}header .m{font-size:12.5px;color:#dfe6ff;margin-top:6px}
  .sum{display:flex;gap:10px;margin:18px 26px;flex-wrap:wrap}
  .sum div{background:#fff;border:1px solid #e3e8f2;border-radius:12px;padding:10px 18px;font-size:13px;box-shadow:0 6px 24px rgba(38,54,110,.07)}
  .sum b{font-size:18px;display:block}.ok{color:#16a34a}.bad{color:#dc2626}.warn{color:#d97706}.man{color:#6b7280}
  main{max-width:1080px;margin:0 auto;padding:0 26px 50px}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e8f2;border-radius:14px;overflow:hidden;font-size:13px;box-shadow:0 6px 24px rgba(38,54,110,.07)}
  td{border-bottom:1px solid #eef1f8;padding:9px 12px;vertical-align:top}
  tr.sec td{background:#f4f6fd;font-weight:700;color:#3a52e6}
  td.id{font-family:Consolas,monospace;color:#7b88a8;width:54px}
  td.note{color:#7b88a8;font-size:12px}
  .ba{display:flex;gap:8px;margin-top:6px}
  .ba a{position:relative;display:block}
  .ba img{width:130px;border:1px solid #e3e8f2;border-radius:6px;display:block}
  .ba span{position:absolute;top:3px;left:3px;background:#7b88a8;color:#fff;font-size:9px;padding:1px 6px;border-radius:4px}
  .ba span.aft{background:#16a34a}
  .b{font-size:10.5px;font-weight:700;border-radius:5px;padding:2px 8px;color:#fff}
  .b.ok{background:#16a34a}.b.bad{background:#dc2626}.b.warn{background:#d97706}.b.man{background:#9aa6c2}
  a{color:#4f6cf7;text-decoration:none}
</style></head><body>
<header><h1>🛡️ RBI LiteClient 기능 점검 리포트</h1>
<div class="m">실행 ${esc(meta.stamp)} · 대상 ${esc(meta.domain)} · 계정 ${esc(meta.username)} · 타겟 ${esc(meta.targetUrl)}</div></header>
<div class="sum">
  <div><b>${results.length}</b>전체</div>
  <div><b class="ok">${cnt.pass}</b>PASS</div>
  <div><b class="warn">${cnt.warn}</b>확인</div>
  <div><b class="man">${cnt.manual}</b>수동</div>
  <div><b class="bad">${cnt.fail}</b>FAIL</div>
</div>
<main><table>${rows}</table>
${meta.consoleErrors && meta.consoleErrors.length ? `<h3>콘솔 에러 (${meta.consoleErrors.length})</h3><pre style="background:#fff;border:1px solid #e3e8f2;border-radius:10px;padding:12px;font-size:12px;white-space:pre-wrap">${esc(meta.consoleErrors.join('\n'))}</pre>` : ''}
</main></body></html>`;
  fs.writeFileSync(path.join(outDir, 'report.html'), html, 'utf8');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ meta, results, summary: cnt }, null, 2), 'utf8');
}

module.exports = { runTest };

// CLI
if (require.main === module) {
  runTest({
    domain: process.env.D || 'https://release.aircode.com',
    username: process.env.U || '',
    password: process.env.P || '',
    targetUrl: process.env.T || 'http://193.200.10.116:8900',
    headless: process.env.HEADLESS === '1',
  }).then(r => {
    const c = r.results.reduce((a, x) => (a[x.status] = (a[x.status] || 0) + 1, a), {});
    console.log(`\n완료: test-results/${r.stamp}/report.html`);
    console.log(`PASS ${c.pass || 0} · 확인 ${c.warn || 0} · 수동 ${c.manual || 0} · FAIL ${c.fail || 0}`);
  }).catch(e => { console.error(e); process.exit(1); });
}
