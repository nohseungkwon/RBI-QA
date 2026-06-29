/** 비우기→업로드→검사완료([class*="action-ico-"] 등장) 대기→다운로드 검증 */
const { chromium } = require('playwright');
const path=require('path'),fs=require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const D='https://release.aircode.com',U=process.env.U||'',P=process.env.P||'',T='http://193.200.10.116:8900';
(async () => {
  const out=path.join(__dirname,'..','test-results','updown'); fs.mkdirSync(out,{recursive:true});
  const b=await chromium.launch({channel:'chrome',headless:false});
  const ctx=await b.newContext({viewport:{width:1520,height:860},ignoreHTTPSErrors:true,acceptDownloads:true});
  const page=await ctx.newPage();
  await page.goto(D+'/userpage/login/',{waitUntil:'domcontentloaded'});
  await page.fill('input[placeholder="아이디"]',U).catch(()=>{}); await page.fill('input[placeholder="비밀번호"]',P).catch(()=>{});
  await page.click('button:has-text("로그인")').catch(()=>{}); await page.waitForURL(/dashboard/,{timeout:20000}).catch(()=>{}); await sleep(2500);
  await page.fill('input[placeholder="웹사이트 주소를 입력하세요."]',T).catch(()=>{});
  let v; try{[v]=await Promise.all([ctx.waitForEvent('page',{timeout:15000}),page.press('input[placeholder="웹사이트 주소를 입력하세요."]','Enter')]);}catch{v=page;}
  await v.waitForLoadState('domcontentloaded').catch(()=>{}); await sleep(9000);
  const fEl=await v.waitForSelector('iframe[name="rbiFrame"], iframe#rbiFrame',{timeout:20000}).catch(()=>null);
  const F=fEl?await fEl.contentFrame():null; await sleep(1500);
  const fileCount=async()=>{const n=await F.locator('#id-rbi-ui-fileBox input[type=checkbox]').count().catch(()=>0);return Math.max(0,n-1);};
  const cntF=async s=>{try{return await F.locator(s).count();}catch{return 0;}};
  try { await v.mouse.click(760,470,{button:'right'}); await sleep(900); await F.locator('#id-rbi-ui-contextmenu-filebox').first().click({force:true}); } catch {}
  await sleep(2000);
  // 비우기
  if(await fileCount()>0){ try{await F.evaluate(()=>{const c=document.querySelector('#id-rbi-ui-fileBox-checkbox-all');if(c&&!c.checked)c.click();});}catch{} await sleep(500); try{await F.locator('#id-rbi-ui-fileBox-delete-files').click({force:true});}catch{} await sleep(900); for(let i=0;i<4;i++){if(!(await F.locator('#id-rbi-ui-rbiPopup').first().isVisible().catch(()=>false)))break; try{await F.locator('#id-rbi-ui-rbiPopup-confirmBtn').click({force:true});}catch{} await sleep(800);} await sleep(1000); }
  // 업로드
  const fp=path.join(out,'updown-sample.txt'); fs.writeFileSync(fp,'updown '+Date.now());
  try{const [fc]=await Promise.all([v.waitForEvent('filechooser',{timeout:9000}),F.locator('#id-rbi-ui-fileBox-open-file-dialog').click({force:true})]);await fc.setFiles(fp);}catch(e){console.log('up',e.message);}
  await sleep(2500);
  if(await F.locator('#id-rbi-ui-rbiPopup').first().isVisible().catch(()=>false)){try{await F.locator('#id-rbi-ui-rbiPopup-confirmBtn').click({force:true});}catch{} await sleep(1500);}
  // 검사완료 대기
  let upCnt=0,dlBtn=0;
  for(let i=0;i<16;i++){upCnt=await fileCount();dlBtn=await cntF('[class*="action-ico-"]');console.log(`폴 ${i}: 파일 ${upCnt} · [class*="action-ico-"] ${dlBtn}`);if(upCnt>=1&&dlBtn>=1)break;await sleep(2000);}
  await v.screenshot({path:path.join(out,'ready.png')});
  // 다운로드 관련 요소 클래스 덤프
  const dump=await F.evaluate(()=>{const box=document.querySelector('#id-rbi-ui-fileBox');if(!box)return{};const cands=[...box.querySelectorAll('[class*="down"],[class*="ico"],button,svg')].map(e=>e.tagName+'.'+(e.className||'').toString().slice(0,28)).filter(s=>/down|ico/i.test(s)).slice(0,15);return{cands};}).catch(e=>({err:e.message}));
  console.log('다운로드 후보:',JSON.stringify(dump));
  // 다운로드 시도
  let dl='(없음)';
  if(dlBtn>0){try{const [d]=await Promise.all([v.waitForEvent('download',{timeout:12000}),F.locator('[class*="action-ico-"]').first().click()]);await d.saveAs(path.join(out,'dl_'+(d.suggestedFilename()||'file'))); dl=d.suggestedFilename();}catch(e){dl='실패:'+e.message;}}
  console.log(JSON.stringify({upCnt,dlBtn,download:dl,out},null,1));
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
