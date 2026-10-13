# 알려진 노이즈

`/oncall alert`가 노이즈로 판정해도 되는 오류의 목록이다. 사람이 관리한다. 에이전트가 올린 Issue가 노이즈였다면 여기에 항목을 더하고 Issue를 닫는다.

항목과 맞아도 "신호로 보는 경우"에 해당하면 신호다.

| 오류 | 알아보는 법 | 왜 노이즈인가 | 신호로 보는 경우 |
|---|---|---|---|
| 개발 환경의 오류 | `breakdowns.host`가 `localhost`나 `127.0.0.1`뿐이다 | 개발 중에 난 오류다. prod 사용자는 겪지 않는다 | 다른 호스트가 하나라도 있다 |
| 봇과 크롤러 | `bot_occurrences`가 `occurrences`와 같거나 `breakdowns.traffic`에 `Regular`가 없다 | 사람이 겪은 오류가 아니다 | `Regular` 사용자가 섞여 있다 |
| 브라우저 확장 프로그램 | 프레임의 `source`가 `chrome-extension://`, `moz-extension://`, `safari-extension://`, `webkit-masked-url://`로 시작하고 이 저장소 코드의 프레임이 없다 | 사용자의 확장 프로그램이 낸 오류다 | 이 저장소 코드의 프레임이 함께 있다 |
| 다른 출처 스크립트의 오류 | 예외 메시지가 `Script error.`뿐이고 프레임이 없다 | 브라우저가 다른 출처 스크립트의 오류 내용을 가린 것이다 | 최근 24시간에 2명 이상이 겪는다 |
| ResizeObserver 알림 지연 | 예외 메시지가 `ResizeObserver loop`로 시작한다 | 브라우저가 레이아웃 알림을 다음 프레임으로 미룬 것이다. 화면은 정상이다 | 없음 |
| 요청 취소 | 예외 종류가 `AbortError`다 | 사용자가 페이지를 떠나 요청이 취소됐다 | 핵심 경로에서 최근 1시간에 2명 이상이 겪는다 |
| 사용자의 네트워크 끊김 | 브라우저(`library`가 `web`)에서 난 `Failed to fetch`, `Load failed`, `NetworkError when attempting to fetch resource` | 사용자의 연결이 끊겼다 | 최근 1시간에 2명 이상이 겪는다. 서버나 CDN 장애일 수 있다 |
| 배포 직후의 청크 로드 실패 | 예외 종류가 `ChunkLoadError`이거나 메시지에 `Loading chunk`, `Failed to fetch dynamically imported module`이 있고, 처음 발생이 기본 브랜치의 최근 커밋 뒤 1시간 안이다 | 열어 둔 탭이 배포로 지워진 옛 파일을 요청했다. 새로 고치면 풀린다 | 최근 커밋이 없거나, 1시간이 지나도 계속 늘어난다 |
