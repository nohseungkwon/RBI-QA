#!/usr/bin/env node
/**
 * 수산 AI DLP 연동 E2E (WSL 스택) — LC(dlpTypeDefault=soosan) → dlp-server 릴레이 → 수산 목서버
 *
 *   node e2e.cjs            (rbi-autotest 의 config.local.json 계정·도메인 사용)
 *
 * 시나리오
 *   P1 프롬프트 허용   : "hello rbi aidlp test" + Enter → 목서버 prompt(block=false) → 전송됨 → SSE 답변 → audit 수신
 *   P2 프롬프트 차단   : "deny secret number" + Enter → 목서버 prompt(block=true) → 입력 폐기 + 차단 안내, audit 없음
 *   F1 파일 차단       : 격리 안 input[type=file] → 파일보관함 → 내PC → deny.txt → 목서버 file(block=true) → 첨부 취소
 *   F2 파일 변환 대체  : mask.txt → 목서버 file(responseFiles) → /files 로 변환본 → 첨부 → 사이트 업로드 바이트 = 변환본
 * 판정 근거는 목서버 __log(요청 실제 수신)·LC 화면 문구·사이트 로그다.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const AT = path.resolve(__dirname, '../rbi-autotest');
const cfg = require(path.join(AT, 'lib/config.cjs'));
const S = require(path.join(AT, 'runner/lib/session.cjs'));
const H = require(path.join(AT, 'runner/lib/harness.cjs'));

const TARGET = process.env.T || 'http://127.0.0.1:8901/chatgpt/';
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
const outDir = path.join(__dirname, 'results', stamp);
fs.mkdirSync(outDir, { recursive: true });
const lines = [];
const log = (...a) => { const m = a.join(' '); console.log(m); lines.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function wsl(cmd) {
  try { return execFileSync('wsl', ['-d', cfg.wslDistro || 'Rocky8', '--', 'bash', '-c', cmd], { encoding: 'utf8', timeout: 20000 }); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}
const mockLog = () => { try { return JSON.parse(wsl('curl -s http://127.0.0.1:8095/api/dlp/__log')); } catch { return []; } };
const mockReset = () => wsl('curl -s http://127.0.0.1:8095/api/dlp/__reset >/dev/null');
const siteLog = () => wsl('tail -n 20 ~/aidlp-test/site.log');
const dlpLog = () => wsl('docker logs --since 3m dlp-dlp-1 2>&1 | grep "\\[aidlp\\]" | tail -n 12');

/** LC 화면(모든 프레임)의 텍스트에서 패턴 찾기 — 토스트/팝업 문구 판정 */
async function findText(page, re) {
  for (const f of page.frames()) {
    const t = await f.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    const m = t.match(re);
    if (m) return m[0];
  }
  return null;
}

/** Enter 직후 N초 동안 화면 문구를 폴링 (토스트는 수 초 뒤 사라진다) */
async function pollText(page, re, ms = 4000) {
  const t0 = Date.now(); let seen = null;
  while (Date.now() - t0 < ms) {
    const m = await findText(page, re);
    if (m) { seen = `${Date.now() - t0}ms: ${m}`; break; }
    await sleep(150);
  }
  return seen;
}

const results = [];
function verdict(id, ok, why, extra = {}) {
  results.push({ id, ok, why, ...extra });
  log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${why}`);
}

(async () => {
  const ctx = {
    cfg, log, outDir, cache: {}, browser: null,
    shot: async (page, name) => { try { const f = name + '.png'; await page.screenshot({ path: path.join(outDir, f) }); return f; } catch { return null; } },
  };
  log(`AI DLP E2E — ${stamp}  ${cfg.baseUrl}  계정 ${cfg.user}  타겟 ${TARGET}`);
  log(`  dlp relay health: ${wsl('curl -s -m 5 http://127.0.0.1:8084/api/dlp/health').trim()}`);
  mockReset();

  const iso = await S.isolate(ctx, TARGET, { interact: false, waitMs: 15000 });
  const page = iso.page;
  log(`  격리 세션: established=${iso.established} 표면=${iso.surface && iso.surface.best ? iso.surface.best.tag + ' ' + iso.surface.best.w + 'x' + iso.surface.best.h : '없음'} 프레임=${iso.obs.frames}`);
  await ctx.shot(page, '00_session');
  const policy = iso.obs.policyResponses.map(p => p.json).find(j => j && (j.paintExtension || j.sitePolicy));
  const sp = policy && (policy.paintExtension ? policy.paintExtension.sitePolicy : policy.sitePolicy);
  log(`  sitePolicy.useDlp=${sp ? sp.useDlp : '?'} dlpType=${sp ? sp.dlpType : '(없음→클라이언트 가정값)'}`);
  // 클라이언트 설정(가정값) 확인
  const cc = iso.obs.policyResponses.map(p => p.json).find(j => j && j.dlpConfig);
  log(`  clientConfig.dlpConfig.dlpTypeDefault=${cc ? cc.dlpConfig.dlpTypeDefault : '?'} dlpMode=${cc ? cc.commonConfig.dlpMode : '?'}`);

  const rect = await H.surfaceRect(page);
  if (!rect) { log('표면 없음 — 중단'); process.exit(2); }
  const vp = { width: rect.w, height: rect.h };          // 격리 뷰포트 = 표면 크기(1:1)로 가정
  const at = (x, y) => H.clickPagePoint(page, rect, vp, x, y);
  log(`  표면 rect=${JSON.stringify(rect)}`);

  // ── P1 프롬프트 허용 ──
  await at(400, 80); await sleep(400);
  await page.keyboard.type('hello rbi aidlp test', { delay: 40 });
  await sleep(300);
  mockReset();
  await page.keyboard.press('Enter');
  await sleep(6000);
  let ml = mockLog();
  const p1 = ml.find(e => e.api === 'prompt');
  await ctx.shot(page, '01_prompt_allow');
  verdict('P1-prompt-allow', !!p1 && p1.block === false && p1.aiService === 268435456,
    p1 ? `목서버 수신 uuid=${p1.messageUuid} aiService=${p1.aiService} loginId=${p1.loginId} dept=${p1.departmentName} Uri=${p1.Uri} block=${p1.block}` : '목서버에 prompt 요청 없음',
    { mock: p1 });
  // ③ audit (SSE 완료 후)
  await sleep(8000);
  ml = mockLog();
  const a1 = ml.find(e => e.api === 'audit');
  verdict('P1-audit', !!a1 && p1 && a1.messageUuid === p1.messageUuid && !!a1.conversationId && (a1.missing || []).length === 0,
    a1 ? `audit uuid=${a1.messageUuid} (①과 ${p1 && a1.messageUuid === p1.messageUuid ? '일치' : '불일치'}) conv=${a1.conversationId} model=${a1.model} ts=${a1.timestamp} missing=${JSON.stringify(a1.missing)}` : 'audit 요청 없음',
    { mock: a1 });

  // ── P2 프롬프트 차단 ──
  await at(400, 80); await sleep(400);
  await page.keyboard.type('deny secret number', { delay: 40 });
  await sleep(300);
  const before = mockLog().length;
  await page.keyboard.press('Enter');
  const toast = await pollText(page, /차단[^\n]{0,60}|DLP 정책[^\n]{0,60}|개인정보[^\n]{0,60}/, 5000);
  await sleep(1500);
  ml = mockLog();
  const p2 = ml.slice(before).find(e => e.api === 'prompt');
  await ctx.shot(page, '02_prompt_block');
  verdict('P2-prompt-block', !!p2 && p2.block === true && !!toast,
    `${p2 ? `목서버 수신 block=${p2.block}` : '목서버에 prompt 요청 없음'} / 화면 문구=${toast ? JSON.stringify(toast) : '없음'}`, { mock: p2, toast });
  await sleep(5000);
  const a2 = mockLog().slice(before).find(e => e.api === 'audit');
  verdict('P2-no-audit', !a2, a2 ? '차단 건인데 audit 전송됨' : '차단 건 audit 없음(정상)');

  // ── F1 파일 차단 ──
  // 실행마다 다른 파일명 — 보관함에 남은 이전 실행 행(검사 실패 BLOCKED)과 중복 처리되지 않게
  const denyFile = path.join(outDir, `deny-${stamp}.txt`);
  fs.writeFileSync(denyFile, 'this file must be blocked by aidlp mock\n');
  const maskFile = path.join(outDir, `mask-${stamp}.txt`); fs.writeFileSync(maskFile, 'original content 0123456789 '.repeat(20) + '\n');
  const beforeF1 = mockLog().length;
  await at(200, 172); await sleep(800);                       // 격리 안 input[type=file] → FILE_DIALOG → LC 파일보관함
  const f1 = await H.feedFileChooser({ page }, [denyFile], { gesture: 'F1', open: () => at(200, 172) });
  const toastF1 = await pollText(page, /첨부[^\n]{0,60}|차단[^\n]{0,60}|DLP 정책[^\n]{0,60}/, 4000);
  await sleep(1500);
  const mf1 = mockLog().slice(beforeF1).find(e => e.api === 'file');
  await ctx.shot(page, '03_file_block');
  verdict('F1-file-block', !!mf1 && mf1.block === true,
    `${mf1 ? `목서버 file 수신 files=${JSON.stringify(mf1.files)} encodetype=${mf1.encodetype} filenames=${mf1.filenames} block=${mf1.block}` : '목서버에 file 요청 없음'} / 화면 문구=${toastF1 ? JSON.stringify(toastF1) : '없음'} / 하니스 stage=${f1.stage} reason=${f1.reason} attached=${f1.attached}`,
    { mock: mf1, harness: { stage: f1.stage, reason: f1.reason, why: f1.why, rows: f1.rows, attached: f1.attached } });
  try { await H.cancelFileChooser({ page }); } catch { }
  await sleep(1500);

  // ── F2 파일 변환 대체 ──
  const beforeF2 = mockLog().length;
  await at(200, 172); await sleep(800);
  const f2 = await H.feedFileChooser({ page }, [maskFile], { gesture: 'F2', open: () => at(200, 172) });
  await sleep(4000);
  const mf2 = mockLog().slice(beforeF2).find(e => e.api === 'file');
  const dl2 = dlpLog();
  await ctx.shot(page, '04_file_mask');
  // 격리 사이트의 '파일 업로드' 버튼 → 사이트가 받은 파일명/바이트 (변환본이면 수십 바이트)
  await at(420, 172); await sleep(4000);
  const sl = siteLog();
  const upl = (sl.match(/files uploaded: .*/g) || []).pop() || '';
  await ctx.shot(page, '05_file_mask_uploaded');
  const bytes = Number((upl.match(/\((\d+) bytes\)/) || [])[1] || 0);
  // 변환본 교체 증거: 파일보관함(entry)이 받은 mask.txt 크기 — 원본(561B)이 아니라 목서버 변환본(수십 B)이어야 한다.
  // (WSL 은 viruschaser 500 으로 entry 가 검사 실패→BLOCKED 처리해 첨부 단계까지는 못 간다 — 환경 문제, 별도 표기)
  const entryUp = wsl('docker logs --since 5m entry-entry-1 2>&1 | grep "chunk upload accepted" | grep "fileName=mask-" | tail -n 1');
  const entrySize = Number((entryUp.match(/size=(\d+)/) || [])[1] || -1);
  const entryScan = wsl('docker logs --since 5m entry-entry-1 2>&1 | grep -E "\\[scan\\] (blocked|done|passed|clean)" | grep "mask-" | tail -n 1').trim().slice(-120);
  const relayDl = /GET \/api\/dlp\/files/.test(dlpLog());   // 릴레이 로그는 쿼리 없이 경로만 남긴다
  verdict('F2-file-mask', !!mf2 && mf2.block === false && (mf2.responseFiles || []).length === 1 && relayDl && entrySize > 0 && entrySize < 200,
    `${mf2 ? `목서버 file 수신 files=${JSON.stringify(mf2.files)} block=${mf2.block} responseFiles=${mf2.responseFiles.length}` : '목서버에 file 요청 없음'} / 릴레이 files 다운로드=${relayDl ? '있음' : '없음'} / 파일보관함 수신 크기=${entrySize}B (원본 ${fs.statSync(maskFile).size}B → 변환본이면 수십 B) / 첨부 단계: 하니스 stage=${f2.stage} attached=${f2.attached}, entry 검사=${entryScan || '기록 없음'}, 사이트 수신=${upl || '없음'}`,
    { mock: mf2, entrySize, entryScan, harness: { stage: f2.stage, reason: f2.reason, why: f2.why, rows: f2.rows, attached: f2.attached }, site: upl });

  log('\n── dlp-server relay log ──\n' + dlpLog());
  log('── mock log ──\n' + JSON.stringify(mockLog(), null, 1).slice(0, 4000));
  const pass = results.filter(r => r.ok).length;
  log(`\n결과: ${pass}/${results.length} PASS  → ${outDir}`);
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ stamp, target: TARGET, results }, null, 2));
  fs.writeFileSync(path.join(outDir, 'log.txt'), lines.join('\n'));
  try { await ctx.browser.close(); } catch { }
  process.exit(pass === results.length ? 0 : 1);
})().catch(async e => {
  log('E2E 예외: ' + (e && e.stack || e));
  fs.writeFileSync(path.join(outDir, 'log.txt'), lines.join('\n'));
  process.exit(3);
});
