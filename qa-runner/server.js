/** QA 러너 웹 서버: 폼(도메인+계정) → 실행 → 진행상황(SSE) → 전/후 스크린샷 리포트 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { runQA } = require('./runner');
const { runTest } = require('./tests/run-test.cjs');

const app = express();
app.use(express.json());
app.use('/results', express.static(path.join(__dirname, 'results')));
app.use('/test-results', express.static(path.join(__dirname, 'test-results')));
app.use(express.static(path.join(__dirname, 'public')));

const runs = {}; // runId -> {events, clients, done, result}

app.post('/api/run', (req, res) => {
  const { domain, username, password, targetUrl, headless, mode } = req.body || {};
  if (!domain || !username || !password) return res.status(400).json({ error: '도메인/아이디/비밀번호는 필수입니다.' });
  const runId = 'r' + Date.now();
  const control = { stopped: false, browser: null };
  runs[runId] = { events: [], clients: [], done: false, result: null, control };
  const emit = ev => { const r = runs[runId]; if (!r) return; r.events.push(ev); r.clients.forEach(c => { try { c.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {} }); };
  // 통합 점검(LiteClient UI + 격리 콘텐츠) = runTest(기본). mode==='isolated'면 격리 콘텐츠 전용 runQA.
  const isolated = mode === 'isolated';
  const runner = isolated ? runQA : runTest;
  const base = isolated ? '/results/' : '/test-results/';
  res.json({ runId, base });
  runner({ domain, username, password, targetUrl: targetUrl || 'http://193.200.10.116:8900', headless: !!headless, control }, emit)
    .then(result => { runs[runId].result = result; emit({ type: 'finished', stamp: result.stamp, base, stopped: control.stopped }); runs[runId].done = true; })
    .catch(e => { emit({ type: 'error', message: e.message }); runs[runId].done = true; });
});

// 실행 중지 — 중지 플래그 + 브라우저 닫기(진행 중 작업 중단 → 남은 항목 skip → 부분 리포트)
app.post('/api/stop/:runId', (req, res) => {
  const r = runs[req.params.runId];
  if (!r) return res.status(404).json({ error: 'unknown run' });
  if (r.control) { r.control.stopped = true; try { if (r.control.browser) r.control.browser.close(); } catch {} }
  const ev = { type: 'log', message: '⏹ 사용자 중지 요청 — 진행 중단' };
  r.events.push(ev); r.clients.forEach(c => { try { c.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {} });
  res.json({ ok: true });
});

app.get('/api/stream/:runId', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders && res.flushHeaders();
  const r = runs[req.params.runId];
  if (!r) { res.write(`data: ${JSON.stringify({ type: 'error', message: 'unknown run' })}\n\n`); return res.end(); }
  r.events.forEach(ev => res.write(`data: ${JSON.stringify(ev)}\n\n`));
  if (r.done) { res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`); return res.end(); }
  r.clients.push(res);
  req.on('close', () => { r.clients = r.clients.filter(c => c !== res); });
});

app.get('/api/runs', (req, res) => {
  const dir = path.join(__dirname, 'results');
  const list = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => fs.existsSync(path.join(dir, f, 'report.json'))).sort().reverse() : [];
  res.json(list);
});

// QA 히스토리 — 지난 실행 목록(요약 포함). test-results(통합) + results(격리) 병합, 최신순.
app.get('/api/history', (req, res) => {
  const dirs = [['/test-results/', path.join(__dirname, 'test-results')], ['/results/', path.join(__dirname, 'results')]];
  const out = [];
  for (const [base, dir] of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const stamp of fs.readdirSync(dir)) {
      const rp = path.join(dir, stamp, 'report.json');
      if (!fs.existsSync(rp)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(rp, 'utf8'));
        const items = j.results || j.steps || [];
        const summary = j.summary || items.reduce((a, x) => (a[x.status] = (a[x.status] || 0) + 1, a), {});
        out.push({ stamp, base, summary, total: items.length, target: (j.meta && j.meta.targetUrl) || '', finishedAt: (j.meta && j.meta.finishedAt) || '', mode: base === '/results/' ? 'isolated' : 'lite' });
      } catch {}
    }
  }
  out.sort((a, b) => b.stamp.localeCompare(a.stamp));
  res.json(out);
});

const PORT = process.env.PORT || 4321;
app.listen(PORT, () => console.log('▶ RBI QA Runner: http://localhost:' + PORT));
