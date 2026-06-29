/** CDR 링크 클릭 시나리오 빠른 검증/좌표 보정 */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const D = process.env.D || 'https://release.aircode.com', U = process.env.U || '', P = process.env.P || '', T = process.env.T || 'http://193.200.10.116:8900';
  const CX = +(process.env.CX || 185), CY = +(process.env.CY || 210);
  const out = path.join(__dirname, '..', 'test-results', 'cdr-check'); fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await b.newContext({ viewport: { width: 1520, height: 860 }, ignoreHTTPSErrors: true, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(D + '/userpage/login/', { waitUntil: 'domcontentloaded' });
  await page.fill('input[placeholder="아이디"]', U).catch(() => {});
  await page.fill('input[placeholder="비밀번호"]', P).catch(() => {});
  await page.click('button:has-text("로그인")').catch(() => {});
  await page.waitForURL(/dashboard/, { timeout: 20000 }).catch(() => {});
  await sleep(2500);
  await page.fill('input[placeholder="웹사이트 주소를 입력하세요."]', T).catch(() => {});
  let v; try { [v] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }), page.press('input[placeholder="웹사이트 주소를 입력하세요."]', 'Enter')]); } catch { v = page; }
  await v.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(9000);
  const fEl = await v.waitForSelector('iframe[name="rbiFrame"], iframe#rbiFrame', { timeout: 20000 }).catch(() => null);
  const F = fEl ? await fEl.contentFrame() : null;
  await sleep(1500);
  await v.screenshot({ path: path.join(out, '1_loaded.png') });

  // CDR 링크 클릭
  await v.mouse.click(CX, CY);
  await sleep(4500);
  await v.screenshot({ path: path.join(out, '2_after_click.png') });

  // 파일보관함 열기
  try { await v.mouse.click(760, 470, { button: 'right' }); await sleep(900); await F.locator('#id-rbi-ui-contextmenu-filebox').first().click({ force: true }); } catch {}
  await sleep(2500);
  await v.screenshot({ path: path.join(out, '3_filebox.png') });
  const docRow = await F.locator('#id-rbi-ui-fileBox').getByText('1D8B742').count().catch(() => 0);
  // CDR 완료 버튼 폴링 + 클릭
  let cdrBtn = 0;
  for (let i = 0; i < 15; i++) { cdrBtn = await F.locator('#id-rbi-ui-fileBox button:has-text("완료"), #id-rbi-ui-fileBox button:has-text("통과")').count().catch(() => 0); if (cdrBtn > 0) break; await sleep(2000); }
  let popup = false;
  if (cdrBtn > 0) {
    const btn = F.locator('#id-rbi-ui-fileBox button:has-text("완료"), #id-rbi-ui-fileBox button:has-text("통과")').first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ force: true }).catch(() => {});
    await sleep(2000);
    popup = await F.locator('#id-rbi-ui-cdrpopup').isVisible().catch(() => false);
    await v.screenshot({ path: path.join(out, '4_cdr_report.png') });
  }
  console.log(JSON.stringify({ click: [CX, CY], docInFileBox: docRow, cdrButton: cdrBtn, cdrPopup: popup, out }, null, 1));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
