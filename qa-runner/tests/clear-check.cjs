/** 파일보관함 비우기(전체선택[JS click]→삭제→확인) 검증 — 파일 2개 업로드 후 삭제 */
const { chromium } = require('playwright');
const path=require('path'), fs=require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const D='https://release.aircode.com',U=process.env.U||'',P=process.env.P||'',T=process.env.T||'http://193.200.10.116:8900';
(async () => {
  const out = path.join(__dirname,'..','test-results','clear-check'); fs.mkdirSync(out,{recursive:true});
  const b = await chromium.launch({ channel:'chrome', headless:false });
  const ctx = await b.newContext({ viewport:{width:1520,height:860}, ignoreHTTPSErrors:true, acceptDownloads:true });
  const page = await ctx.newPage();
  await page.goto(D+'/userpage/login/',{waitUntil:'domcontentloaded'});
  await page.fill('input[placeholder="아이디"]',U).catch(()=>{}); await page.fill('input[placeholder="비밀번호"]',P).catch(()=>{});
  await page.click('button:has-text("로그인")').catch(()=>{}); await page.waitForURL(/dashboard/,{timeout:20000}).catch(()=>{}); await sleep(2500);
  await page.fill('input[placeholder="웹사이트 주소를 입력하세요."]',T).catch(()=>{});
  let v; try{[v]=await Promise.all([ctx.waitForEvent('page',{timeout:15000}),page.press('input[placeholder="웹사이트 주소를 입력하세요."]','Enter')]);}catch{v=page;}
  await v.waitForLoadState('domcontentloaded').catch(()=>{}); await sleep(9000);
  const fEl = await v.waitForSelector('iframe[name="rbiFrame"], iframe#rbiFrame',{timeout:20000}).catch(()=>null);
  const F = fEl ? await fEl.contentFrame() : null; await sleep(1500);
  const cnt = async()=>{const n=await F.locator('#id-rbi-ui-fileBox input[type=checkbox]').count().catch(()=>0);return Math.max(0,n-1);};
  try { await v.mouse.click(760,470,{button:'right'}); await sleep(900); await F.locator('#id-rbi-ui-contextmenu-filebox').first().click({force:true}); } catch {}
  await sleep(2000);
  for (const nm of ['clear-a.txt','clear-b.txt']) {
    const fp = path.join(out, nm); fs.writeFileSync(fp, 'sample '+nm+' '+Date.now());
    try { const [fc]=await Promise.all([v.waitForEvent('filechooser',{timeout:9000}), F.locator('#id-rbi-ui-fileBox-open-file-dialog').click({force:true})]); await fc.setFiles(fp); } catch(e){ console.log('업로드 실패',nm,e.message); }
    await sleep(2500);
    // 덮어쓰기 팝업이면 확인
    if (await F.locator('#id-rbi-ui-rbiPopup').first().isVisible().catch(()=>false)) { try{await F.locator('#id-rbi-ui-rbiPopup-confirmBtn').click({force:true});}catch{} await sleep(1500); }
  }
  await v.screenshot({path:path.join(out,'1_populated.png')});
  const before = await cnt();
  // 전체선택(JS click) → 삭제 → 확인
  try { await F.evaluate(()=>{const c=document.querySelector('#id-rbi-ui-fileBox-checkbox-all'); if(c&&!c.checked)c.click();}); } catch(e){console.log('체크박스',e.message);}
  await sleep(500); await v.screenshot({path:path.join(out,'2_selected.png')});
  try { await F.locator('#id-rbi-ui-fileBox-delete-files').click({force:true}); } catch(e){console.log('삭제버튼',e.message);}
  await sleep(900);
  let popupSeen=false;
  for(let i=0;i<4;i++){ const vis=await F.locator('#id-rbi-ui-rbiPopup').first().isVisible().catch(()=>false); if(!vis)break; popupSeen=true; let clicked=false; try{const c=F.locator('#id-rbi-ui-rbiPopup-confirmBtn'); if(await c.count()>0){await c.click({force:true});clicked=true;}}catch{} if(!clicked){try{await F.locator('#id-rbi-ui-rbiPopup button:has-text("확인")').first().click({force:true});}catch{}} await sleep(800); }
  await sleep(1500);
  await v.screenshot({path:path.join(out,'3_after_delete.png')});
  const after = await cnt();
  console.log(JSON.stringify({before, after, popupSeen, cleared: after===0, out},null,1));
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
