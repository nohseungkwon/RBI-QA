/** 클립보드(복사/잘라내기) 버튼 좌표 빠른 검증/보정 */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const D = process.env.D || 'https://release.aircode.com', U = process.env.U || '', P = process.env.P || '', T = process.env.T || 'http://193.200.10.116:8900';
  const BCX = +(process.env.BCX || 335), BCY = +(process.env.BCY || 366), PDX = +(process.env.PDX || 545), PDY = +(process.env.PDY || 366);
  const KCX = +(process.env.KCX || 900), KCY = +(process.env.KCY || 366), CDX = +(process.env.CDX || 1115), CDY = +(process.env.CDY || 366);
  const out = path.join(__dirname, '..', 'test-results', 'clip-check'); fs.mkdirSync(out, { recursive: true });
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
  await v.waitForSelector('iframe[name="rbiFrame"], iframe#rbiFrame', { timeout: 20000 }).catch(() => null);
  await sleep(1500);
  await v.screenshot({ path: path.join(out, '0_loaded.png') });

  // IC-1 복사 → 붙여넣기
  await v.screenshot({ path: path.join(out, 'IC1_before.png') });
  await v.mouse.click(BCX, BCY); await sleep(700);          // 복사 버튼 클릭(execCommand copy)
  await v.mouse.click(PDX, PDY); await sleep(300);          // 붙여넣기 칸 포커스
  await v.keyboard.press('Control+a'); await sleep(150);
  await v.keyboard.press('Control+v'); await sleep(900);
  await v.screenshot({ path: path.join(out, 'IC1_after.png') });

  // IC-2 잘라내기 → 붙여넣기
  await v.screenshot({ path: path.join(out, 'IC2_before.png') });
  await v.mouse.click(KCX, KCY); await sleep(800);          // 잘라내기 클릭(copy+clear) — 클립보드 적재
  await v.mouse.click(CDX, CDY); await sleep(300);          // 붙여넣기 칸 포커스
  await v.keyboard.press('Control+a'); await sleep(150);
  await v.keyboard.press('Control+v'); await sleep(900);
  await v.screenshot({ path: path.join(out, 'IC2_after.png') });

  console.log(JSON.stringify({ btnCopy: [BCX, BCY], pasteDst: [PDX, PDY], btnCut: [KCX, KCY], cutDst: [CDX, CDY], out }, null, 1));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
