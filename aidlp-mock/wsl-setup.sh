#!/bin/bash
# WSL Rocky8: 수산 목서버·가짜 ChatGPT 사이트 기동 + dlp 컨테이너에 AI DLP 릴레이 핫배포
set -u
SRC=/mnt/c/Development/Project/RBI
TEST=$HOME/aidlp-test
DLP=$HOME/cloud/dlp/bin

echo "== 1. mock + site =="
mkdir -p "$TEST"
cp "$SRC/rbi.ai/aidlp-mock/server.js" "$TEST/mock.js"
cp "$SRC/rbi.ai/aidlp-mock/chatgpt-site.js" "$TEST/site.js"
sed -i 's/\r$//' "$TEST"/*.js
# 자기 자신(bash)이 잡히지 않도록 [m] 트릭
pkill -f "[n]ode mock.js" 2>/dev/null || true
pkill -f "[n]ode site.js" 2>/dev/null || true
sleep 1
cd "$TEST"
nohup node mock.js 8095 > mock.log 2>&1 &
nohup node site.js 8901 > site.log 2>&1 &
sleep 2
echo "-- mock prompt:"; curl -s -X POST http://127.0.0.1:8095/api/dlp/prompt -H 'Content-Type: application/json' -d '{"messageUuid":"w1","loginId":"dev01","aiService":268435456,"prompt":"hello"}'; echo
echo "-- site GET:"; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8901/chatgpt/
echo "-- site SSE (first 2 lines):"; curl -s -N -X POST http://127.0.0.1:8901/backend-api/conversation -H 'Content-Type: application/json' -d '{"messages":[{"content":{"parts":["hi"]}}]}' | head -2
pgrep -af "aidlp-test" | grep -v pgrep || true

echo "== 2. dlp relay hot deploy =="
cp -n "$DLP/dlp/src/index.js" "$DLP/dlp/src/index.js.bak-aidlp-20260904" 2>/dev/null || true
cp -n "$DLP/dlp.template.properties" "$DLP/dlp.template.properties.bak-aidlp-20260904" 2>/dev/null || true
cp "$SRC/dlp-server/src/routes/aidlp.js" "$DLP/dlp/src/routes/aidlp.js"
sed -i 's/\r$//' "$DLP/dlp/src/routes/aidlp.js"
node - "$DLP/dlp/src/index.js" <<'EOF'
const fs = require('fs'); const p = process.argv[2]; let s = fs.readFileSync(p, 'utf8');
if (s.includes("routes/aidlp")) { console.log('index.js: already patched'); process.exit(0); }
const block = `
// AI DLP 릴레이 (수산 등 외부 AI DLP) — aidlp.url 이 설정된 경우에만 활성. 기존 /api/evaluate 와 무관. (hot-deploy 2026-09-04)
if ((config.aidlp && config.aidlp.url) || process.env.DLP_AIDLP_URL) {
  app.use('/api/dlp', require('./routes/aidlp'));
  logger.info('AI DLP relay enabled: ' + (config.aidlp && config.aidlp.url || process.env.DLP_AIDLP_URL));
} else {
  logger.info('AI DLP relay disabled (aidlp.url not set)');
}
`;
const anchors = ["app.use('/api/management', managementRoutes);", "app.use('/api', evaluationRoutes);"];
let done = false;
for (const a of anchors) { const i = s.indexOf(a); if (i !== -1) { const j = i + a.length; s = s.slice(0, j) + block + s.slice(j); done = true; break; } }
if (!done) { console.error('index.js: anchor not found'); process.exit(2); }
fs.writeFileSync(p, s); console.log('index.js: patched');
EOF
for f in "$DLP/dlp.template.properties" "$DLP/dlp.properties"; do
  if ! grep -q "^aidlp.url=" "$f"; then
    printf '\n# AI DLP relay (hot-deploy 2026-09-04, 수산 목서버)\naidlp.url=http://127.0.0.1:8095\naidlp.backupurl=\naidlp.authheader=\naidlp.prompttimeoutms=8000\naidlp.filetimeoutms=50000\n' >> "$f"
    echo "appended aidlp.* -> $f"
  else
    echo "aidlp.* already in $f"
  fi
done
docker restart dlp-dlp-1 >/dev/null && echo "dlp restarted"
sleep 6
echo "-- dlp log (relay lines):"; docker logs --since 40s dlp-dlp-1 2>&1 | grep -i "aidlp\|AI DLP\|started on\|error" | tail -6
echo "-- relay direct (8084):"; curl -s -X POST http://127.0.0.1:8084/api/dlp/prompt -H 'Content-Type: application/json' -d '{"messageUuid":"w2","loginId":"dev01","aiService":268435456,"prompt":"내 주민등록번호는"}'; echo
echo "-- relay health:"; curl -s http://127.0.0.1:8084/api/dlp/health; echo
echo "-- via ingre (https, same-origin path):"; curl -sk -X POST https://airrbi.aircode.com/dlp/api/dlp/prompt -H 'Content-Type: application/json' -d '{"messageUuid":"w3","loginId":"dev01","aiService":268435456,"prompt":"hello via ingre"}' --resolve airrbi.aircode.com:443:127.0.0.1; echo
echo "-- evaluate still works:"; curl -s -X POST http://127.0.0.1:8084/api/evaluate -H 'Content-Type: application/json' -d '{"text":"hello"}' | head -c 200; echo
echo "== 3. LC config template =="
LC=$HOME/cloud/liteclient/bin
cp -n "$LC/clientConfig.template.json" "$LC/clientConfig.template.json.bak-aidlp-20260904" 2>/dev/null || true
node - "$LC/clientConfig.template.json" "$LC/liteclient/config/clientConfig.json" <<'EOF'
const fs = require('fs');
for (const p of process.argv.slice(2)) {
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('dlpTypeDefault')) { console.log(p + ': already has dlpTypeDefault'); continue; }
  const re = /("airDlpPort"\s*:\s*"58443")\s*\n(\s*)\}/;
  if (!re.test(s)) { console.error(p + ': anchor not found'); continue; }
  s = s.replace(re, '$1,\n        "dlpTypeDefault" : "soosan",\n        "aiDlp" : { "baseUrl" : "/dlp/api/dlp", "promptTimeoutMs" : 8000, "fileTimeoutMs" : 50000 }\n$2}');
  fs.writeFileSync(p, s); console.log(p + ': patched');
}
EOF
grep -n -A3 '"airDlpPort"' "$LC/clientConfig.template.json"
echo "== done =="
