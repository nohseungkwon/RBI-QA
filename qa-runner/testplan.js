/**
 * 테스트 플랜 설정.
 *
 * COORDS: 격리 뷰어(캔버스) 안에서 클릭/포커스할 좌표.
 *   격리 화면은 픽셀 스트리밍(canvas)이라 DOM 셀렉터를 쓸 수 없어 좌표로 클릭한다.
 *   ▶ 1회 실행 후 results/<시각>/03_clipboard_before.png 등을 열어 실제 위치를 확인하고
 *     아래 값을 보정하면 정확도가 올라간다. (뷰포트 VIEWPORT 기준 픽셀)
 */
module.exports = {
  VIEWPORT: { width: 1520, height: 820 },

  // 로그인/대시보드(실 DOM) 셀렉터 — 여러 후보를 순서대로 시도
  SEL: {
    loginId: ['input[placeholder="아이디"]', 'input[type="text"]', '#username'],
    loginPw: ['input[placeholder="비밀번호"]', 'input[type="password"]'],
    loginBtn: ['button:has-text("로그인")', 'button[type="submit"]'],
    search: ['input[placeholder="웹사이트 주소를 입력하세요."]', 'input[placeholder*="주소"]'],
  },

  // 격리 뷰어 캔버스 좌표.
  //  ▶ 03~07단계는 copySrc 1회 클릭으로 포커스를 잡은 뒤 Tab 키로 이동하므로
  //    아래에서 실제로 쓰이는 값은 copySrc(최초 포커스 클릭) 하나뿐. 나머지는 참고용.
  //    copySrc 클릭이 빗나가면 1번 셀 입력칸 중앙 좌표로 보정(첫 실행 03_clipboard_before.png 참고).
  COORDS: {
    copySrc:  { x: 468, y: 312 },    // 1번 셀(클립보드) 원본 입력칸
    pasteDst: { x: 552, y: 356 },    // 1번 셀 붙여넣기 칸
    cutSrc:   { x: 1033, y: 312 },   // 2번 셀(잘라내기) 원본
    cutDst:   { x: 1122, y: 356 },   // 2번 셀 붙여넣기 칸
    findInput:{ x: 392, y: 530 },    // 3번 셀(검색) 입력칸
    downloadTxt: { x: 830, y: 528 }, // 4번 셀 텍스트(.txt) 다운로드 버튼
    videoPlay: { x: 245, y: 250 },   // (5×500 스크롤 후) ▶ 재생 버튼
  },

  // 검색어
  FIND_QUERY: 'RBI',

  // 각 동작 후 렌더 안정화 대기(ms)
  WAIT: { afterLogin: 3000, afterLaunch: 8000, afterAction: 1800, render: 1200 },
};
