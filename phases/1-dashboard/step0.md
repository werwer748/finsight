# Step 0: transaction-types

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (개발 단계: 이 phase는 `1-dashboard`다)
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md` (ADR-004, ADR-012, ADR-014)
- `/scripts/tdd_guard.py`
- `/src/types/auth.ts` (타입 파일의 기존 모양)
- `/src/lib/auth/validation.ts`, `/src/lib/auth/validation.test.ts` (순수 함수와 테스트의 기존 모양)

## 작업

이 phase 전체가 함께 쓰는 거래 타입과 카테고리 목록을 정의한다. 뒤의 step들이 이 이름을 그대로 가져다 쓰므로 아래 이름과 값을 바꾸지 마라.

구현 파일보다 테스트 파일을 먼저 작성하라. `tdd_guard.py`가 `src/lib/` 아래 구현 파일을 같은 폴더의 테스트가 먼저 변경되지 않으면 막는다.

### 1. 카테고리 목록 (`src/lib/transactions/categories.ts`)

```ts
// Claude가 가맹점명을 보고 고를 수 있는 카테고리. 순서가 화면 정렬의 동률 기준이 된다.
export const MERCHANT_CATEGORIES = [
  "식비",
  "카페·간식",
  "마트·편의점",
  "쇼핑",
  "교통·차량",
  "주거·통신",
  "의료·건강",
  "문화·여가",
  "여행·숙박",
  "교육",
  "금융·보험",
  "기타",
] as const;

// 코드가 직접 붙이는 카테고리. Claude는 이 값을 고르지 않는다.
export const TRANSFER_CATEGORY = "이체"; // 은행 내역에서 카드 결제로 확인되지 않은 출금 (이체·송금·자동이체·현금 인출 등)
export const INCOME_CATEGORY = "수입"; // kind가 income인 모든 거래
export const FALLBACK_CATEGORY = "기타"; // 분류하지 못한 출금. MERCHANT_CATEGORIES 안의 값이다.

export function isMerchantCategory(value: unknown): value is MerchantCategory;
```

- 가운뎃점은 `·`(U+00B7)이다. 다른 점 문자로 바꾸지 마라.
- 카테고리 목록의 원본은 `MERCHANT_CATEGORIES` 배열 하나다. 같은 문자열 목록을 다른 파일에 다시 적지 마라.

### 2. 타입 (`src/types/transaction.ts`)

```ts
export type MerchantCategory = (typeof MERCHANT_CATEGORIES)[number];
export type Category =
  | MerchantCategory
  | typeof TRANSFER_CATEGORY
  | typeof INCOME_CATEGORY;

export type TransactionKind = "expense" | "income";

// 파일에서 읽어 정규화한 거래 한 건. 아직 카테고리가 없다.
export type ParsedTransaction = {
  date: string; // "YYYY-MM-DD". 파일에 적힌 날짜 그대로이며 시간대 변환을 하지 않는다.
  time: string | null; // "HH:mm". 24시간제이고 두 자리로 채운다. 파일에 시각이 없으면 null.
  merchant: string; // 가맹점명 또는 적요. 빈 문자열일 수 있다.
  amount: number; // 원 단위 정수. 취소·환불은 음수다.
  kind: TransactionKind;
  isTransfer: boolean; // 은행 내역의 출금 중 카드 결제로 확인되지 않은 거래. 이체로 분류하고 LLM에 보내지 않는다.
};

// 카테고리가 붙은 거래. time을 뺀 나머지가 DB에 저장된다.
export type CategorizedTransaction = {
  date: string;
  time: string | null;
  merchant: string;
  amount: number;
  kind: TransactionKind;
  category: Category;
};

// DB에서 읽은 거래. time은 저장하지 않으므로 없다.
export type Transaction = Omit<CategorizedTransaction, "time"> & { id: string };
```

- 타입은 `src/types/transaction.ts`에서 export 한다. 타입끼리의 순환 import가 문제가 되면 한쪽에서 정의하고 다른 쪽에서 re-export 해도 된다.
- `MerchantCategory`는 `MERCHANT_CATEGORIES`에서 파생시켜라. 문자열 유니온을 손으로 다시 적지 마라. 이유: 목록이 두 군데로 갈라지면 한쪽만 고쳐지는 버그가 난다.
- `time`은 step 7이 중복 판별용 지문을 만드는 데만 쓴다. 이유: 같은 날 같은 곳에서 같은 금액을 쓴 서로 다른 거래가 서로 다른 파일(카드 두 장, 한 계좌를 기간을 나눠 받은 내역 두 개)에 들어 있으면 날짜·내용·금액만으로는 지문이 같아져 나중에 올린 거래가 중복으로 버려진다. 시각이 있으면 둘을 구별할 수 있다 (ADR-014).
- `time`은 DB에 저장하지 않는다. 그래서 `Transaction`은 `CategorizedTransaction`에서 `time`을 뺀 모양이다.

### 3. 테스트 (`src/lib/transactions/categories.test.ts`)

- 파일 첫 줄에 `// @vitest-environment node`를 둔다.
- `MERCHANT_CATEGORIES`는 12개이고 중복이 없다.
- `FALLBACK_CATEGORY`는 `MERCHANT_CATEGORIES`에 들어 있다.
- `TRANSFER_CATEGORY`와 `INCOME_CATEGORY`는 `MERCHANT_CATEGORIES`에 들어 있지 않다.
- `isMerchantCategory`: 목록의 값은 true, `"이체"`, `"수입"`, `""`, `undefined`, `123`, 목록에 없는 문자열은 false.

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY npm run build
npm run test
test -f src/lib/transactions/categories.test.ts && test -f src/types/transaction.ts
test "$(grep -c '"식비"' src/lib/transactions/categories.ts)" = "1"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/1-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (만든 파일 경로와 export 이름을 적는다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트와 API 키는 이 step에 필요하지 않다. 키가 없다는 이유로 `blocked` 처리하지 마라.

## 금지사항

- 파일 파싱, 분류, 집계 함수를 만들지 마라. 이유: 뒤의 step 범위다. 이 step은 타입과 상수뿐이다.
- 카테고리별 색상, 아이콘, 설명 문구를 추가하지 마라. 이유: 쓰는 곳이 없다.
- 패키지를 설치하지 마라. 이유: 이 step에는 필요가 없다.
- 기존 테스트를 깨뜨리지 마라.
