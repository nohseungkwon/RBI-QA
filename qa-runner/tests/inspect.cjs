/** LiteClient DOM 인벤토리 수집: iframe 구조 + id-rbi-ui* 요소(초기/우클릭 후) 덤프 */
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const domain = process.env.D || 'https://release.aircode.com';
  const user = process.env.U || '';
  const pw = process.env.P || '';
  const target = process.env.T || 'http://193.200.10.116:8900';

  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1520, height: 820 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(domain + '/userpage/login/', { waitUntil: 'domcontentloaded' });
  await page.fill('input[placeholder="아이디"]', user).catch(() => {});
  await page.fill('input[placeholder="비밀번호"]', pw).catch(() => {});
  await page.click('button:has-text("로그인")').catch(() => {});
  await page.waitForURL(/dashboard/, { timeout: 20000 }).catch(() => {});
  await sleep(2500);

  const search = 'input[placeholder="웹사이트 주소를 입력하세요."]';
  await page.fill(search, target).catch(() => {});
  let viewer;
  try { [viewer] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }), page.press(search, 'Enter')]); }
  catch { viewer = page; }
  await viewer.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(9000);

  async function scan(label) {
    const frames = viewer.frames();
    const result = [];
    for (const f of frames) {
      let els = [];
      try {
        els = await f.evaluate(() => [...document.querySelectorAll('[id*="rbi-ui"]')].map(e => ({
          id: e.id, tag: e.tagName.toLowerCase(),
          vis: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length),
          text: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
        })));
      } catch (e) { els = [{ err: e.message }]; }
      if (els.length) result.push({ frameUrl: f.url().slice(0, 70), name: f.name(), count: els.length, els });
    }
    console.log('\n===== ' + label + ' (frames: ' + frames.length + ') =====');
    console.log(JSON.stringify(result, null, 1));
  }

  await scan('초기 상태');
  // 캔버스 우클릭 → 컨텍스트 메뉴
  try { await viewer.mouse.click(760, 420, { button: 'right' }); } catch {}
  await sleep(1500);
  await scan('우클릭(컨텍스트메뉴) 후');

  await browser.close();
})().catch(e => { console.error('INSPECT ERROR:', e.message); process.exit(1); });
