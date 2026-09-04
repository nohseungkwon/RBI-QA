'use strict';
/**
 * 수산 AI DLP 목서버 (연동문서 AIDLP-연동-API-규격 기준) — 의존성 없음 (Node 18+)
 *
 *   node server.js [port]          기본 8095
 *   AIDLP_MOCK_AUTH=Bearer xxx     설정 시 Authorization 헤더가 다르면 401
 *
 * 규칙 (dlp-server 릴레이 → 이 서버):
 *   ① POST /api/dlp/prompt  본문에 '주민등록번호' 또는 'deny' → block(reason 0x400 패턴 본문). 'sleep' → 15초 지연(타임아웃 유도).
 *                           reason 표기는 요청마다 number ↔ "0x…" 문자열을 번갈아 준다(LC BigInt 파싱 검증).
 *   ② POST /api/dlp/file    파일명에 'deny' → block(reason 0x40000 첨부파일 이름). 'mask' → responseFiles 로 변환본 제공.
 *   ②-1 GET /api/dlp/files?uuid=   변환본 바이너리 + Content-Disposition
 *   ③ POST /api/dlp/audit   200. 콘솔에 질문·답변 요약 출력.
 *   GET /api/dlp/__log      지금까지 받은 요청 요약(JSON) — 자동화 검증용
 */
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.argv[2] || process.env.PORT || 8095);
const AUTH = process.env.AIDLP_MOCK_AUTH || '';
const REASON = { PATTERN_BODY: 0x400n, ATTACH_NAME: 0x40000n, ATTACH_VIRUS: 0x8000000n };

const files = new Map();      // fileUuid -> { name, body }
const log = [];               // 요청 요약
let reasonToggle = 0;

function reasonValue(bits) {
  reasonToggle++;
  return reasonToggle % 2 === 0 ? Number(bits) : '0x' + bits.toString(16);
}
function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length });
  res.end(data);
}
function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
/** multipart 에서 파일 파트(filename 있는 것)만 추출 — 목서버용 최소 파서 */
function parseMultipart(buf, contentType) {
  const m = /boundary=("?)([^";]+)\1/i.exec(contentType || '');
  if (!m) return { fields: {}, files: [] };
  const boundary = Buffer.from('--' + m[2]);
  const fields = {}; const out = [];
  let start = buf.indexOf(boundary);
  while (start !== -1) {
    const next = buf.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    const part = buf.subarray(start + boundary.length + 2, next - 2);      // \r\n 제거
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString();
      const body = part.subarray(headerEnd + 4);
      const name = /name="([^"]+)"/.exec(headers)?.[1];
      const filename = /filename="([^"]*)"/.exec(headers)?.[1];
      if (filename !== undefined) out.push({ field: name, filename, body });
      else if (name) fields[name] = body.toString();
    }
    start = next;
  }
  return { fields, files: out };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  if (AUTH && req.headers.authorization !== AUTH) {
    console.log(`[mock] 401 ${req.method} ${path} (authorization: ${req.headers.authorization || '-'})`);
    return json(res, 401, { error: 'unauthorized' });
  }

  if (req.method === 'GET' && path === '/api/dlp/__log') return json(res, 200, log);
  if (req.method === 'GET' && path === '/api/dlp/__reset') { log.length = 0; files.clear(); return json(res, 200, { ok: true }); }

  if (req.method === 'POST' && path === '/api/dlp/prompt') {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const text = String(body.prompt ?? '');
    if (/sleep/i.test(text)) await new Promise(r => setTimeout(r, 15000));
    const block = /주민등록번호|deny/i.test(text);
    const resp = { block, message: block ? '개인정보(주민등록번호) 포함으로 차단되었습니다.' : '', reason: block ? reasonValue(REASON.PATTERN_BODY) : 0 };
    log.push({ api: 'prompt', at: Date.now(), messageUuid: body.messageUuid, aiService: body.aiService, loginId: body.loginId,
               departmentName: body.departmentName, Uri: body.Uri, conversationId: body.conversationId, block });
    console.log(`[mock] prompt uuid=${body.messageUuid} aiService=${body.aiService} user=${body.loginId}/${body.departmentName} block=${block} :: ${text.slice(0, 60)}`);
    return json(res, 200, resp);
  }

  if (req.method === 'POST' && path === '/api/dlp/file') {
    const raw = await readBody(req);
    const { fields, files: parts } = parseMultipart(raw, req.headers['content-type']);
    let payload = {};
    try { payload = JSON.parse(fields.payload || '{}'); } catch (e) { /* ignore */ }
    const names = parts.map(p => p.filename);
    const block = names.some(n => /deny/i.test(n)) || /sleep/i.test(names.join(','));
    if (/sleep/i.test(names.join(','))) await new Promise(r => setTimeout(r, 60000));
    const responseFiles = [];
    if (!block) {
      for (const p of parts) {
        if (/mask/i.test(p.filename)) {
          const uuid = crypto.randomUUID();
          files.set(uuid, { name: p.filename, body: Buffer.from(`[MASKED by aidlp-mock] ${p.filename} (${p.body.length} bytes)\n`) });
          responseFiles.push({ fileUuid: uuid, fileName: p.filename });
        }
      }
    }
    log.push({ api: 'file', at: Date.now(), messageUuid: payload.messageUuid, aiService: payload.aiService, encodetype: fields.encodetype,
               filenames: fields.filenames, files: names, block, responseFiles });
    console.log(`[mock] file uuid=${payload.messageUuid} files=${JSON.stringify(names)} encodetype=${fields.encodetype} filenames=${fields.filenames} block=${block} masked=${responseFiles.length}`);
    return json(res, 200, { block, message: block ? '첨부파일 이름 정책 위반으로 차단되었습니다.' : '', reason: block ? reasonValue(REASON.ATTACH_NAME) : 0, responseFiles });
  }

  if (req.method === 'GET' && path === '/api/dlp/files') {
    const f = files.get(url.searchParams.get('uuid'));
    if (!f) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': f.body.length,
      'content-disposition': `attachment; filename="${encodeURIComponent(f.name)}"; filename*=UTF-8''${encodeURIComponent(f.name)}` });
    console.log(`[mock] files uuid=${url.searchParams.get('uuid')} -> ${f.name}`);
    return res.end(f.body);
  }

  if (req.method === 'POST' && path === '/api/dlp/audit') {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const missing = ['messageUuid', 'loginId', 'aiService', 'prompt', 'answer', 'conversationId', 'timestamp', 'departmentName', 'Uri'].filter(k => body[k] == null || body[k] === '');
    log.push({ api: 'audit', at: Date.now(), messageUuid: body.messageUuid, conversationId: body.conversationId, model: body.model, timestamp: body.timestamp, missing });
    console.log(`[mock] audit uuid=${body.messageUuid} conv=${body.conversationId} ts=${body.timestamp} missing=${JSON.stringify(missing)} :: Q=${String(body.prompt).slice(0, 40)} / A=${String(body.answer).slice(0, 40)}`);
    res.writeHead(200); return res.end();
  }

  json(res, 404, { error: `no route ${req.method} ${path}` });
});

server.listen(PORT, () => console.log(`[mock] 수산 AI DLP mock listening on http://0.0.0.0:${PORT}  (auth: ${AUTH ? 'required' : 'none'})`));
