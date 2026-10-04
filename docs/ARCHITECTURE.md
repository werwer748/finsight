# 아키텍처

## 디렉토리 구조
```
src/
├── app/               # 페이지 + API 라우트 (얇게 유지)
├── components/        # UI 컴포넌트
│   └── ui/            # 공용 기본 컴포넌트 (Button, Input, Card)
├── types/             # TypeScript 타입 정의
├── lib/               # 유틸리티 + 헬퍼 (검증, 집계, Supabase 클라이언트)
└── services/          # 외부 API 래퍼 (Claude, Polar)
supabase/
└── migrations/        # DB 스키마와 RLS 정책 (SQL)
```

테스트는 별도 폴더가 아니라 구현 파일 옆에 둔다 (`button.tsx` 옆에 `button.test.tsx`).

## 패턴
- Server Components 기본. 인터랙션이 필요한 곳만 Client Component.
- 데이터 변경은 서버 액션으로 한다. 외부에서 호출되는 엔드포인트(웹훅, 파일 업로드)만 `src/app/api/` 라우트 핸들러로 만든다.
- 페이지 파일은 데이터 조회와 컴포넌트 조합만 한다. 계산·검증 로직은 `src/lib/`의 순수 함수로 빼서 테스트한다.
- Claude와 Polar는 `src/services/`의 래퍼를 거쳐서만 호출한다. 테스트에서는 래퍼를 mock으로 대체하고 실제 API를 호출하지 않는다.
- 환경변수는 사용하는 시점에 읽는다. 모듈을 import하는 것만으로 예외가 나면 안 된다 (환경변수 없이도 빌드가 통과해야 한다).

## 데이터 흐름
```
인증:  가입·로그인 폼 → 서버 액션 → Supabase Auth → 세션 쿠키 → 보호된 페이지

분석:  파일 업로드 → 파싱(행을 거래로 정규화)
       → 가맹점 분류(캐시 조회, 없으면 Claude 호출 후 캐시에 저장)
       → DB 저장 → 코드로 집계 → 대시보드 렌더링

결제:  업그레이드 버튼 → Polar 결제 페이지 → 웹훅 → DB의 플랜 갱신 → 서버에서 권한 체크
```

## 상태 관리
- 서버 상태는 Server Components에서 직접 조회한다.
- 클라이언트 상태는 useState/useReducer로 충분하다. 전역 상태 라이브러리는 쓰지 않는다.
- 로그인 세션은 Supabase가 쿠키로 관리한다.
