/** 사용자 제공 naver 토큰으로 자동화 클립보드(합성키) 동작 여부 검증 (로그인 후 토큰 URL로 격리) */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const D = process.env.D || 'https://release.aircode.com', U = process.env.U || '', P = process.env.P || '';
const TOKEN_URL = process.env.TURL;
const SX = +(process.env.SX || 760), SY = +(process.env.SY || 300);
(async () => {
  const out = path.join(__dirname, '..', 'test-results', 'naver-clip'); fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await b.newContext({ viewport: { width: 1520, height: 860 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  // 1) 로그인(세션 확보)
  await page.goto(D + '/userpage/login/', { waitUntil: 'domcontentloaded' });
  await page.fill('input[placeholder="아이디"]', U).catch(() => {});
  await page.fill('input[placeholder="비밀번호"]', P).catch(() => {});
  await page.click('button:has-text("로그인")').catch(() => {});
  await page.waitForURL(/dashboard/, { timeout: 20000 }).catch(() => {});
  await sleep(2500);
  // 2) 토큰 URL로 격리 naver 실행 (새 탭으로 열릴 수 있음)
  let v;
  try { [v] = await Promise.all([ctx.waitForEvent('page', { timeout: 12000 }), page.goto(TOKEN_URL, { waitUntil: 'domcontentloaded' })]); }
  catch { v = page; }
  await v.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(11000);
  await v.waitForSelector('iframe[name="rbiFrame"], iframe#rbiFrame', { timeout: 20000 }).catch(() => {});
  await sleep(2000);
  await v.screenshot({ path: path.join(out, '1_loaded.png') });
  // 3) 검색창 클릭 → 타이핑
  await v.mouse.click(SX, SY); await sleep(500);
  await v.keyboard.type('RBICLIPTEST', { delay: 40 }); await sleep(500);
  await v.screenshot({ path: path.join(out, '2_typed.png') });
  // 4) 전체선택 → 잘라내기(합성 Ctrl+X)
  await v.keyboard.press('Control+a'); await sleep(300);
  await v.keyboard.press('Control+x'); await sleep(700);
  await v.screenshot({ path: path.join(out, '3_after_cut.png') });
  // 5) 붙여넣기(합성 Ctrl+V)
  await v.keyboard.press('Control+v'); await sleep(800);
  await v.screenshot({ path: path.join(out, '4_after_paste.png') });
  console.log(JSON.stringify({ url: (v.url && v.url()) || '', search: [SX, SY], out }, null, 1));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
