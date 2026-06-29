/** 사용자 메뉴(.user-menu-list, #id-rbi-ui-moreicon) 실제 항목 인벤토리 */
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const D = process.env.D || 'https://release.aircode.com', U = process.env.U || '', P = process.env.P || '', T = process.env.T || 'http://193.200.10.116:8900';
  const b = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await b.newContext({ viewport: { width: 1520, height: 860 }, ignoreHTTPSErrors: true });
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
  await sleep(8000);
  const fEl = await v.waitForSelector('iframe[name="rbiFrame"], iframe#rbiFrame', { timeout: 20000 }).catch(() => null);
  const F = fEl ? await fEl.contentFrame() : null;
  await sleep(1500);

  // 더보기 아이콘 클릭 → 사용자 메뉴 펼치기
  await F.locator('#id-rbi-ui-moreicon').click().catch(() => {});
  await sleep(1500);

  const dump = await F.evaluate(() => {
    const more = document.querySelector('#id-rbi-ui-moreicon');
    const out = { moreClass: more ? more.className : null, hasUserMenuListLiteral: !!document.querySelector('.user-menu-list'), items: [] };
    if (more) {
      out.items = [...more.querySelectorAll('li')].map(li => ({
        order: li.getAttribute('order'),
        cls: li.className,
        text: (li.querySelector('.item')?.textContent || li.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
        vis: !!(li.offsetWidth || li.offsetHeight)
      }));
      const logout = more.querySelector('button');
      out.logoutBtn = logout ? { text: logout.textContent.trim(), cls: logout.className } : null;
      out.ulClass = more.querySelector('ul')?.className || null;
    }
    return out;
  });
  console.log(JSON.stringify(dump, null, 1));
  await v.screenshot({ path: require('path').join(__dirname, '..', 'test-results', 'usermenu-inspect.png') }).catch(() => {});
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
