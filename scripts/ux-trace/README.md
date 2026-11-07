# 화면 점검 (Playwright)

실제 화면을 사람이 쓰듯 조작하고 결과를 `PASS` / `FAIL` 한 줄씩 출력하는 브라우저 점검 모음이다. 엔진·서버 테스트
(`npm test`)가 다루지 못하는 편집기 입력, 끌기, 메뉴, 보기 전환, 설정 화면 같은 동작을 확인한다.

## 실행

Playwright와 Chromium이 필요하다(`PLAYWRIGHT_MODULE`로 설치 위치를 지정할 수 있다).

- **자기 서버를 띄우는 점검**(빈 폴더로 시작해 끝나면 지운다): `local-suite24.mjs` 이후 대부분.

  ```sh
  node scripts/ux-trace/local-suite38.mjs
  ```

- **실행 중인 앱에 붙는 점검**: 시험용 페이지와 데이터베이스를 새로 만들어 쓰므로, 실제 자료가 아닌 시험용 폴더로 띄운
  앱에 연결한다(`node scripts/handoff-ui-fixture.mjs`가 시험용 서버를 띄우고 주소를 출력한다).

  ```sh
  node scripts/ux-trace/local-suite4.mjs http://127.0.0.1:PORT
  node scripts/ux-trace/local-suite2.mjs --base http://127.0.0.1:PORT --db DB페이지ID [blockdrag,ctx,emoji,…]
  node scripts/ux-trace/nav-local.mjs --base http://127.0.0.1:PORT
  ```

각 파일 맨 위 주석에 무엇을 점검하는지와 사용법이 있다.

## 움직임 기록기

`recorder.js`는 입력 직후 약 1초 동안 **프레임마다** 다음을 기록한다. 화면 전환이나 애니메이션이 바뀌었을 때 전후를
비교하는 데 쓴다.

- 입력 시각(pointerdown/keydown/pointerover 기준 0ms)
- 장면 탐침 값(목록 순서·강조 위치·패널 위치/투명도/변형·스크롤 위치 등, 바뀔 때만)
- 그 순간 돌고 있는 CSS 전환·애니메이션의 속성·시간·가속 곡선(`document.getAnimations()`)
- 레이아웃 흔들림(layout-shift)
