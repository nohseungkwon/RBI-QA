# aidlp-mock — 수산 AI DLP 목서버

연동문서(`rbi-liteclient/docs/AIDLP-연동-API-규격-문의.md`) 규격의 4개 API 를 흉내 내는 의존성 없는 Node 서버.
dlp-server 릴레이(`/api/dlp/*`)의 업스트림으로 두고 LC → dlp-server → 목서버 E2E 를 돌린다.

```bash
node server.js 8095                 # 기본 8095
AIDLP_MOCK_AUTH="Bearer test" node server.js   # 인증 헤더 검증까지
```

dlp-server 쪽 설정: `aidlp.url=http://<이 PC IP>:8095` (WSL 스택이면 Windows 호스트 IP).

| 규칙 | 동작 |
|---|---|
| 프롬프트에 `주민등록번호` 또는 `deny` | `block:true`, reason 0x400(패턴 본문). reason 은 요청마다 number ↔ `"0x400"` 문자열 번갈아 |
| 프롬프트에 `sleep` | 15초 지연 → LC 8초 타임아웃 → 차단(fail-close) 확인용 |
| 파일명에 `deny` | `block:true`, reason 0x40000(첨부파일 이름) |
| 파일명에 `mask` | 허용 + `responseFiles` 변환본 제공 → LC 가 `/files?uuid=` 로 받아 교체 |
| 파일명에 `sleep` | 60초 지연 → 파일 타임아웃 확인용 |
| `GET /api/dlp/__log` | 받은 요청 요약(JSON). `__reset` 으로 초기화 |

콘솔에 요청별 요약(messageUuid·aiService·사용자·차단 여부, audit 의 필수 필드 누락 목록)이 찍힌다.
