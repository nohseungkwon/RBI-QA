'use strict';
/**
 * 가짜 ChatGPT 사이트 (격리 브라우저 E2E 용) — 의존성 없음 (Node 18+)
 *
 *   node chatgpt-site.js [port]      기본 8901
 *
 * - GET  /chatgpt/                       입력창(textarea)·전송·파일 첨부 UI. URL 에 'chatgpt' 가 들어가 LC 가 CHATGPT 로 인식한다.
 * - POST /backend-api/conversation       ChatGPT 형식 SSE (input_message → add → append… → [DONE]).
 *                                        LC 의 NETWORK_INTERCEPT 규칙( suffix '/conversation' )과 ChatGPTStreamParser 에 맞춘다.
 * - POST /backend-api/files              첨부 파일 수신(내용은 버림). 업로드 성공 확인용.
 */
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.argv[2] || process.env.PORT || 8901);
const CONV_ID = crypto.randomUUID();

const PAGE = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>Fake ChatGPT (aidlp E2E)</title>
<style>
  body{margin:0;font-family:sans-serif;background:#f6f6f6}
  #wrap{padding:24px}
  #log{height:260px;overflow:auto;background:#fff;border:1px solid #ccc;padding:12px;margin-bottom:12px;white-space:pre-wrap;font-size:14px}
  #prompt{width:100%;height:120px;font-size:18px;box-sizing:border-box}
  .row{margin-top:10px;display:flex;gap:12px;align-items:center}
  button{font-size:16px;padding:8px 16px}
  #status{font-size:14px;color:#555}
</style></head>
<body><div id="wrap">
  <!-- 좌표 클릭 E2E 용 고정 배치: textarea = y 24~144, 버튼행 = y 156~200 (격리 뷰포트 좌상단 기준) -->
  <textarea id="prompt" placeholder="메시지를 입력하고 Enter"></textarea>
  <div class="row">
    <button id="send">전송</button>
    <input type="file" id="file" multiple>
    <button id="upload">파일 업로드</button>
    <span id="status"></span>
  </div>
  <h2 style="margin:12px 0">Fake ChatGPT — conversation ${CONV_ID}</h2>
  <div id="log"></div>
</div>
<script>
  const logEl = document.getElementById('log'), ta = document.getElementById('prompt'), st = document.getElementById('status');
  const log = (t) => { logEl.textContent += t + '\\n'; logEl.scrollTop = logEl.scrollHeight; };
  async function send() {
    const text = ta.value.trim(); if (!text) return;
    ta.value = ''; log('Q: ' + text); st.textContent = 'sending…';
    const res = await fetch('/backend-api/conversation', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'next', messages: [{ id: crypto.randomUUID(), author: { role: 'user' }, content: { content_type: 'text', parts: [text] } }], conversation_id: '${CONV_ID}', model: 'gpt-5-mini' }) });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let answer = '';
    while (true) { const { value, done } = await reader.read(); if (done) break;
      for (const line of dec.decode(value).split('\\n')) { if (!line.startsWith('data: ')) continue; const j = line.slice(6).trim(); if (j === '[DONE]') break;
        try { const d = JSON.parse(j); if (Array.isArray(d.v)) for (const p of d.v) if (p.o === 'append') answer += p.v; } catch (e) {} } }
    log('A: ' + answer); st.textContent = 'done';
  }
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  document.getElementById('send').addEventListener('click', send);
  document.getElementById('upload').addEventListener('click', async () => {
    const files = document.getElementById('file').files; if (!files.length) { st.textContent = 'no file'; return; }
    const fd = new FormData(); for (const f of files) fd.append('files', f, f.name);
    const r = await fetch('/backend-api/files', { method: 'POST', body: fd }); const j = await r.json();
    log('UPLOADED: ' + j.names.join(', ') + ' (' + j.bytes + ' bytes)'); st.textContent = 'uploaded';
  });
  document.getElementById('file').addEventListener('change', () => { st.textContent = 'selected: ' + [...document.getElementById('file').files].map(f => f.name).join(', '); });
</script></body></html>`;

function sse(res, question) {
  const qid = crypto.randomUUID(), aid = crypto.randomUUID();
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const line = o => res.write('data: ' + JSON.stringify(o) + '\n\n');
  line({ type: 'input_message', input_message: { id: qid, author: { role: 'user' }, content: { content_type: 'text', parts: [question] },
         metadata: { request_id: crypto.randomUUID(), turn_exchange_id: crypto.randomUUID(), turn_trace_id: crypto.randomUUID(), resolved_model_slug: 'gpt-5-mini' } },
         conversation_id: CONV_ID });
  line({ o: 'add', v: { message: { id: aid, author: { role: 'assistant' }, content: { content_type: 'text', parts: [''] },
         metadata: { parent_id: qid, resolved_model_slug: 'gpt-5-mini' } }, conversation_id: CONV_ID } });
  const answer = `"${question}" 에 대한 가짜 답변입니다. 오늘 과천의 날씨는 맑고 기온은 28도입니다.`;
  const pieces = answer.match(/.{1,6}/g) || [answer];
  let i = 0;
  const t = setInterval(() => {
    if (i < pieces.length) { line({ v: [{ p: '/message/content/parts/0', o: 'append', v: pieces[i++] }] }); return; }
    clearInterval(t); res.write('data: [DONE]\n\n'); res.end();
  }, 40);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && (url.pathname === '/chatgpt/' || url.pathname === '/chatgpt' || url.pathname === '/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE);
  }
  if (req.method === 'POST' && url.pathname === '/backend-api/conversation') {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      let q = '';
      try { const b = JSON.parse(Buffer.concat(chunks).toString()); q = b.messages?.[0]?.content?.parts?.join('') ?? ''; } catch (e) {}
      console.log(`[site] conversation Q=${q.slice(0, 60)}`);
      sse(res, q);
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/backend-api/files') {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const names = [...raw.toString('latin1').matchAll(/filename="([^"]*)"/g)].map(m => Buffer.from(m[1], 'latin1').toString('utf8'));
      console.log(`[site] files uploaded: ${names.join(', ')} (${raw.length} bytes)`);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ names, bytes: raw.length }));
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});
server.listen(PORT, () => console.log(`[site] fake ChatGPT on http://0.0.0.0:${PORT}/chatgpt/  conversation=${CONV_ID}`));
