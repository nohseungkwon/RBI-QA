# AirRBI 사용자 포털 — QA 자동화 러너

**서비스 도메인 + 계정을 입력하면** → RBI 포털에 로그인 → 대시보드 검색창으로 **테스트 타겟 사이트를 격리 실행** → 클립보드·잘라내기·문자열검색·파일보관함·비디오 기능을 자동 조작하며 **동작 전/후 스크린샷**을 `results/<YYYYMMDDHHMMSS>/` 폴더에 저장하고 **리포트**로 보여줍니다.

## 구성
```
qa-runner/
├─ server.js        # 웹 서버(폼 입력 → 실행 → SSE 진행 → 리포트)
├─ runner.js        # Playwright 자동화 엔진(로그인·격리실행·기능검증·전후 스크린샷)
├─ report.js        # 전/후 스크린샷 HTML 리포트 생성
├─ testplan.js      # ★셀렉터/좌표/대기시간 설정(보정 포인트)
├─ public/index.html# 입력 폼 + 결과 뷰어 UI
├─ tests/run-test.cjs   # ★LiteClient 기능 점검(36항목, DOM 셀렉터 기반) + CDR 시나리오
└─ test-results/<시각>/ # LiteClient 점검 결과(체크별 스크린샷 + report.html/json)
   results/<시각>/      # (runner.js) 전/후 스크린샷 결과
```

## 점검 엔트리 — 웹 UI(모드 선택) 또는 CLI
**웹 UI**(`npm start` → http://localhost:4321)에서 모드를 선택해 실행 → 진행 체크리스트 + 전/후 리포트를 한 화면에서 본다.
- **통합 점검(권장)**: LiteClient UI + **격리 콘텐츠(섹션 1B: 클립보드·잘라내기·검색·비디오)** + CDR + 사용자메뉴 + RBI UI를 **한 실행**으로.
- **⏹ 중지**: 실행 중 중지 버튼 → `POST /api/stop/:runId`가 브라우저를 닫고 남은 항목을 `skip(중지)` 처리 → 부분 리포트 생성.

| 모드 | 대상 | 방식 | CLI | 결과 |
|---|---|---|---|---|
| **LiteClient 기능 점검** | 툴바·컨텍스트메뉴·파일보관함·인쇄·찾기·**CDR**·**사용자메뉴**·**RBI UI** | rbiFrame 안 `id-rbi-ui-*` **DOM 셀렉터**(견고) | `node tests/run-test.cjs` | `test-results/<시각>/` |
| **격리 콘텐츠 동작** | 클립보드·검색·잘라내기·다운로드·비디오 | 캔버스 좌표 + 전/후 | `node runner.js` | `results/<시각>/` |

### LiteClient 36항목 점검 (`tests/run-test.cjs`)
```
node tests/run-test.cjs              # 환경변수 D/U/P/T 로 도메인·아이디·비번·타겟 지정
D=https://<RBI도메인> U=<아이디> P='<비밀번호>' T=http://<테스트타겟호스트>:<포트> node tests/run-test.cjs
```
- 초기로딩·네비·컨텍스트메뉴·파일보관함·업로드·다운로드·Ctrl+F·인쇄미리보기·클립보드·세션·콘솔에러 = **11개 영역**
- **12. CDR 무해화 시나리오**: `test-site/cdr-sample/1D8B742.doc` 를 **테스트 페이지 좌상단 고정 링크 클릭**으로 다운로드(좌표 185,210) → 파일보관함 → **검사완료(완료 버튼)** → 클릭 → **CDR 리포트 팝업(처리내역 총/무해화/제거)** 까지 자동 검증. (URL바 방식은 rbiFrame 재생성 문제로 폐기, 링크 클릭이 더 현실적)
- **13. 사용자 메뉴(`.user-menu-list`)**: `#id-rbi-ui-moreicon` 펼침 → 새창열기·즐겨찾기·허용된정책확인·인쇄·파일보관함·캐시비우기·교육동영상·로그아웃 각 항목 **동작 전/후(before·after) 스크린샷** 캡처(PRD 5장 데이터 구조). ⚠️ `.user-menu-list`는 CSS 모듈 해시 클래스라 리터럴 셀렉터 불가 → `#id-rbi-ui-moreicon` + `li[order]`/`li[class*="bookmarks"|"pol-"]`/텍스트로 셀렉트.
- **14. RBI UI 기능(`#id-rbi-ui`, PRD 3.7)**: 공유하기(`#id-rbi-ui-urlsharing-area`)·인증서안전아이콘·검색엔진선택·URL입력창·세션타이머·연결아이콘·DLP아이콘·파일보관함아이콘 표시/동작 검증.
- LiteClient UI는 `rbiFrame` iframe 안 실제 DOM(`id-rbi-ui-*`)이라 좌표가 아닌 셀렉터로 검증 → 안정적
- ⚠️ 일부 키 입력 상호작용(Ctrl+F·인쇄)은 스트리밍/포커스 타이밍에 따라 간헐 실패할 수 있어 재시도 로직 포함. 실패 시 재실행 권장.

## 사전 준비
1. **Node.js** (v18+), **시스템 Chrome** 설치 (브라우저 다운로드 없이 시스템 Chrome 사용)
2. **테스트 타겟 사이트 호스팅 + 화이트리스트 등록**
   - `../test-site/` 를 UG가 접근 가능한 URL로 호스팅:
     ```
     cd ../test-site && python -m http.server 8900   # → http://<이 머신 IP>:8900
     ```
   - 관리 콘솔(admin)에서 그 URL을 **화이트리스트 + 앱/사이트 정책**에 등록(클립보드/다운로드/인쇄/워터마크 정책을 원하는 조합으로).

## 설치 & 실행
```bash
cd qa-runner
# 시스템 Chrome 사용 → 브라우저 다운로드 생략
set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1   # (bash: export ...)
npm install
npm start                                 # → http://localhost:4321
```
브라우저로 **http://localhost:4321** 접속 → 도메인/타겟URL/아이디/비밀번호 입력 → **▶ QA 실행**.
실행 중 Chrome 창이 떠서 자동으로 조작되고, 끝나면 단계별 **동작 전/후 이미지**가 화면에 표시됩니다.

### CLI로도 실행
```bash
node runner.js https://release.aircode.com dev01@aircode.com '비밀번호' http://193.200.10.116:8900
# → results/<시각>/report.html
```

## 검증 항목(7단계)
| # | 단계 | 동작 | 전/후로 확인할 것 |
|---|---|---|---|
| 01 | 로그인 | 아이디/비번 입력→로그인 | 로그인 페이지 → 대시보드 |
| 02 | 격리 실행 | 검색창에 타겟URL→실행 | 대시보드 → 격리 뷰어 렌더 |
| 03 | 클립보드 | 복사→붙여넣기(Ctrl+C/V) | 붙으면 허용 / 비면 정책 차단 |
| 04 | 잘라내기 | Ctrl+X→Ctrl+V | 원본 비고 대상에 붙으면 PASS |
| 05 | 문자열 검색 | 검색어 입력 | 본문 하이라이트·건수 |
| 06 | 파일보관함 | 다운로드 클릭 | "파일보관함 기록(검사중→완료)" 표시 |
| 07 | 비디오 | 재생 클릭 | "▶ 재생중 N.Ns" 갱신 |

> 03~07은 결과를 사람이 스크린샷으로 확인하도록 **"확인"** 상태로 표기됩니다(정책에 따라 허용/차단이 정상 동작일 수 있으므로).

## ⚠️ 좌표 보정 (중요)
격리 화면은 픽셀 스트리밍(canvas)이라 DOM 셀렉터를 쓸 수 없어 **좌표 클릭**을 사용합니다. 1회 실행 후 `results/<시각>/03_clipboard_before.png` 등을 열어 실제 버튼/입력칸 위치를 확인하고 **`testplan.js`의 `COORDS`** 값을 보정하세요. (해상도·뷰포트에 따라 달라짐)

## 주의
- 비밀번호는 로그인 자동화에만 쓰이며 디스크에 저장하지 않습니다(`report.json`엔 아이디만 기록).
- 타겟URL이 화이트리스트에 없으면 02 단계에서 **차단 페이지**가 떠 "확인" 처리됩니다(정상적인 차단 동작 검증도 됨).
- 공용 staging에서는 다운로드/세션 등 부수효과를 고려해 실행하세요.
