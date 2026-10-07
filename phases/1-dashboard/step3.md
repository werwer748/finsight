# Step 3: merchant-classifier

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL: LLM에는 가맹점명과 집계된 통계만 보낸다)
- `/docs/ARCHITECTURE.md` (데이터 흐름의 "분석")
- `/docs/ADR.md` (ADR-004, ADR-010, ADR-012)
- `/scripts/tdd_guard.py`
- `/src/types/transaction.ts`, `/src/lib/transactions/categories.ts` (step 0 산출물)
- `/src/lib/parser/normalize.ts` (step 2 산출물: `isTransfer`가 어떻게 정해지는지)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

파싱된 거래에 카테고리를 붙이는 순수 로직을 만든다. 캐시 저장소와 Claude 호출은 이 step에서 구현하지 않고 함수 인자로 주입받는다. 실제 구현은 step 5(Claude)와 step 7(DB)이 만든다.

이 step의 핵심은 **무엇을 밖으로 내보내지 않는지**다. 아래 규칙은 ADR-012를 코드로 지키는 유일한 지점이므로 테스트로 고정하라.

구현 파일보다 테스트 파일을 먼저 작성하라.

### 1. `src/lib/classify/merchant-key.ts`

```ts
// 캐시와 Claude에 쓰는 가맹점 키. 원문 대신 이 키만 밖으로 나간다.
export function toMerchantKey(merchant: string): string;
```

- 앞뒤 공백을 없애고 연속된 공백을 한 칸으로 줄인다.
- 숫자와 하이픈만으로 이어진 구간 중 **숫자가 4개 이상** 든 구간은 구간 전체를 `*` 한 글자로 바꾼다. 이유: 계좌번호, 카드번호, 전화번호, 승인번호가 가맹점명에 붙어 오는 경우가 있다.

| 입력 | 결과 |
|---|---|
| `  스타벅스   강남점 ` | `스타벅스 강남점` |
| `쿠팡 1234567890` | `쿠팡 *` |
| `110-123-456789 홍길동` | `* 홍길동` |
| `스타벅스 1234점` | `스타벅스 *점` |
| `GS25 역삼점` | `GS25 역삼점` |
| `24시 마트 123호` | `24시 마트 123호` |

### 2. `src/lib/classify/classify-transactions.ts`

```ts
export type ClassifyDeps = {
  // 이 사용자의 캐시 전체. 키는 toMerchantKey의 결과다.
  loadCache: () => Promise<Map<string, MerchantCategory>>;
  // 가맹점 키 목록을 분류한다. 분류하지 못한 키는 결과에 없다.
  classify: (keys: string[]) => Promise<Map<string, MerchantCategory>>;
  // 새로 분류된 대응을 캐시에 저장한다.
  saveCache: (entries: Map<string, MerchantCategory>) => Promise<void>;
};

// 입력과 같은 길이, 같은 순서로 돌려준다.
export async function classifyTransactions(
  transactions: ParsedTransaction[],
  deps: ClassifyDeps,
): Promise<CategorizedTransaction[]>;
```

규칙:

1. `kind`가 `income`인 거래는 `INCOME_CATEGORY`.
2. `kind`가 `expense`이고 `isTransfer`가 true인 거래는 `TRANSFER_CATEGORY`.
3. 1과 2에 해당하는 거래의 `merchant`는 `classify`의 인자에도 `saveCache`의 인자에도 **절대 들어가지 않는다**. 원문도, 키로 바꾼 값도 안 된다.
4. 나머지 출금 거래는 `toMerchantKey(merchant)`로 키를 만든다. 키가 빈 문자열이면 `FALLBACK_CATEGORY`이고 밖으로 내보내지 않는다.
5. 캐시에 있는 키는 캐시의 카테고리를 쓴다. 캐시에 없는 키만 중복 없이, 처음 나온 순서대로 모아 `classify`를 **한 번** 호출한다.
6. `classify`에 넘기는 값은 키 문자열 배열뿐이다. 금액, 날짜, 원문 `merchant`를 넘기지 마라.
7. `classify`가 돌려준 값 중 요청하지 않은 키와 `isMerchantCategory`를 통과하지 못하는 값은 버린다.
8. 새로 분류된 대응이 하나라도 있으면 `saveCache`를 한 번 호출한다. 분류하지 못한 키는 저장하지 않는다. 이유: 실패를 캐시에 남기면 다음 업로드에서 다시 시도하지 못한다.
9. 끝까지 카테고리를 얻지 못한 거래는 `FALLBACK_CATEGORY`.
10. `classify`가 예외를 던지면 결과가 없는 것으로 보고 계속 진행한다. 이유: Claude 장애 때문에 업로드가 실패하면 안 된다. `console.error`로 남기되 가맹점명과 키를 로그에 넣지 마라.
11. `loadCache`와 `saveCache`의 예외는 그대로 던진다. 이유: DB 장애면 뒤의 저장도 실패하므로 숨길 이유가 없다.
12. 분류 대상(규칙 4의 빈 키를 뺀 나머지 출금)이 하나도 없으면 `loadCache`, `classify`, `saveCache`를 호출하지 않는다. 캐시에 없는 키가 없으면 `classify`와 `saveCache`를 호출하지 않는다.
13. 결과 객체에는 `isTransfer`가 없다. `merchant`는 원문을 그대로 둔다 (키로 바꾸지 않는다).

### 3. 테스트

- 두 테스트 파일 모두 첫 줄에 `// @vitest-environment node`를 둔다.
- `merchant-key.test.ts`: 위 표의 모든 경우와 빈 문자열.
- `classify-transactions.test.ts`: `deps`는 `vi.fn()`으로 만든다.
  - 입금 거래와 이체 거래의 `merchant`(예: `홍길동`)가 `classify`와 `saveCache`의 어떤 호출 인자에도 나타나지 않는다. 이 테스트는 반드시 있어야 한다.
  - `classify`의 인자에 숫자 4개 이상이 든 구간이 없다 (`쿠팡 1234567890` → `쿠팡 *`).
  - 캐시에 있는 가맹점은 `classify`로 가지 않는다.
  - 같은 가맹점이 여러 번 나와도 `classify`에는 한 번만 들어간다.
  - `classify`가 일부만 돌려주면 나머지는 `기타`이고 `saveCache`에는 돌려받은 것만 들어간다.
  - `classify`가 reject 해도 함수는 resolve 하고 해당 거래는 `기타`다. `saveCache`는 호출되지 않는다.
  - `classify`가 목록에 없는 카테고리나 요청하지 않은 키를 돌려주면 버린다.
  - `loadCache`가 reject 하면 함수도 reject 한다.
  - 입금과 이체만 있는 입력에서는 `deps`의 세 함수가 모두 호출되지 않는다.
  - 결과의 길이와 순서가 입력과 같고 `isTransfer` 키가 없다.

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY npm run build
npm run test
test -f src/lib/classify/merchant-key.test.ts && test -f src/lib/classify/classify-transactions.test.ts
! grep -rn "supabase\|anthropic\|@/services" src/lib/classify --include="*.ts" --exclude="*.test.ts"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (특히 LLM 전송 범위)
3. 결과에 따라 `phases/1-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (파일 경로, `ClassifyDeps`의 모양, 밖으로 나가지 않는 거래의 조건을 적는다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트와 API 키는 이 step에 필요하지 않다. 키가 없다는 이유로 `blocked` 처리하지 마라.

## 금지사항

- 이 폴더에서 Supabase나 Anthropic SDK를 import 하지 마라. 이유: 의존성을 주입받아야 mock 없이 규칙을 테스트할 수 있고, 외부 호출은 `src/services/`와 step 7의 저장소 모듈이 맡는다.
- 가맹점명으로 카테고리를 정하는 키워드 사전(`스타벅스` → `카페·간식` 같은 규칙)을 만들지 마라. 이유: 분류는 Claude와 캐시가 맡는다 (ADR-004).
- 사람 이름처럼 보이는 문자열을 추측해서 걸러내는 규칙을 넣지 마라. 이유: 짧은 가맹점명까지 걸러져 분류율이 떨어진다. 이름 보호는 이체·입금 행 제외로 한다 (ADR-012).
- 저장하는 `merchant`를 키로 바꾸지 마라. 이유: 사용자는 자기 내역의 원문을 봐야 한다. 가리는 것은 밖으로 나가는 값뿐이다.
- 패키지를 설치하지 마라. 이유: 이 step에는 필요가 없다.
- 기존 테스트를 깨뜨리지 마라.
