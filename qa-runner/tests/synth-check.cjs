/** 테스트사이트(HTTP)에서 '합성키' 클립보드(한 칸 내 타이핑→Ctrl+X→Ctrl+V)가 되는지 naver와 동일 방식으로 검증 */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const D='https://release.aircode.com',U=process.env.U||'',P=process.env.P||'',T=process.env.T||'http://193.200.10.116:8900';
const FX=+(process.env.FX||545), FY=+(process.env.FY||366);   // pasteDst(평범한 입력칸, onclick 없음)
(async () => {
  const out = path.join(__dirname,'..','test-results','synth-check'); fs.mkdirSync(out,{recursive:true});
  const b = await chromium.launch({ channel:'chrome', headless:false });
  const ctx = await b.newContext({ viewport:{width:1520,height:860}, ignoreHTTPSErrors:true });
  const page = await ctx.newPage();
  await page.goto(D+'/userpage/login/',{waitUntil:'domcontentloaded'});
  await page.fill('input[placeholder="아이디"]',U).catch(()=>{});
  await page.fill('input[placeholder="비밀번호"]',P).catch(()=>{});
  await page.click('button:has-text("로그인")').catch(()=>{});
  await page.waitForURL(/dashboard/,{timeout:20000}).catch(()=>{});
  await sleep(2500);
  await page.fill('input[placeholder="웹사이트 주소를 입력하세요."]',T).catch(()=>{});
  let v; try{[v]=await Promise.all([ctx.waitForEvent('page',{timeout:15000}),page.press('input[placeholder="웹사이트 주소를 입력하세요."]','Enter')]);}catch{v=page;}
  await v.waitForLoadState('domcontentloaded').catch(()=>{});
  await sleep(9000);
  await v.waitForSelector('iframe[name="rbiFrame"], iframe#rbiFrame',{timeout:20000}).catch(()=>{});
  await sleep(1500);
  // 한 칸(pasteDst)에 타이핑 → Ctrl+A → Ctrl+X → Ctrl+V (naver와 동일)
  await v.mouse.click(FX,FY); await sleep(400);
  await v.keyboard.type('RBICLIPTEST',{delay:40}); await sleep(400);
  await v.screenshot({path:path.join(out,'1_typed.png')});
  await v.keyboard.press('Control+a'); await sleep(250);
  await v.keyboard.press('Control+x'); await sleep(700);
  await v.screenshot({path:path.join(out,'2_after_cut.png')});
  await v.keyboard.press('Control+v'); await sleep(800);
  await v.screenshot({path:path.join(out,'3_after_paste.png')});
  console.log(JSON.stringify({field:[FX,FY],out},null,1));
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
