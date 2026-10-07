# Step 1: sheet-reader

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (핵심 기능 1, MVP 제외 사항)
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md` (ADR-006, ADR-013)
- `/scripts/tdd_guard.py`
- `/package.json`
- `/src/types/transaction.ts`, `/src/lib/transactions/categories.ts` (step 0 산출물)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

올라온 파일의 바이트를 문자열 2차원 배열(표)로 바꾸는 함수를 만든다. 어느 열이 날짜이고 금액인지는 이 step에서 해석하지 않는다. 그 일은 step 2가 한다.

구현 파일보다 테스트 파일을 먼저 작성하라.

### 1. SheetJS 설치

```bash
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

`package.json`의 dependencies에 `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`가 들어가야 한다. 네트워크 문제로 설치가 안 되면 `blocked`로 기록하고 중단하라.

### 2. `src/lib/parser/read-sheet.ts`

```ts
export type SheetGrid = string[][];

// message는 사용자에게 그대로 보여 주는 한국어 문구다.
export class ParseError extends Error {}

// 실패하면 ParseError를 던진다. 디스크와 네트워크를 건드리지 않는 순수 함수다.
export function readSheet(data: Uint8Array, fileName: string): SheetGrid;
```

규칙:

1. **확장자**: `.csv`, `.xlsx`, `.xls`만 받는다(대소문자 무시). 그 외는 `ParseError("지원하지 않는 파일 형식이에요. CSV 또는 Excel(.xlsx, .xls) 파일을 올려 주세요.")`.
2. **텍스트 판별**: `.csv`는 항상 텍스트로 읽는다. `.xls`와 `.xlsx`는 BOM과 앞쪽 공백을 건너뛴 첫 글자가 `<`이면 HTML 표로 보고 텍스트로 읽는다(국내 은행이 HTML 표를 `.xls`로 내려 주는 경우). 아니면 바이너리로 SheetJS에 넘긴다.
3. **텍스트 디코딩**: 먼저 UTF-8로 엄격하게 디코딩한다(`new TextDecoder("utf-8", { fatal: true })`). 실패하면 EUC-KR로 디코딩한다(`new TextDecoder("euc-kr")`). BOM은 제거한다. CSV와 HTML이 같은 디코딩 함수를 쓴다. 디코딩한 문자열을 SheetJS에 넘긴다.
4. **셀 값은 문자열 그대로**: 텍스트 형식(CSV, HTML)의 셀은 SheetJS가 숫자나 날짜로 해석하지 못하게 하라. `0012`가 `12`로, `2026.09.01`이 다른 모양으로 바뀌면 안 된다.
5. **바이너리 형식의 셀**:
   - 숫자 셀은 표시 형식과 상관없이 실제 값의 문자열이다 (`4500`, 천 단위 쉼표 없음).
   - 날짜 셀은 표시 형식과 상관없이 `YYYY-MM-DD`이고, 시각이 있으면 `YYYY-MM-DD HH:mm:ss`다.
   - 날짜 셀을 JS `Date`로 바꿨다가 로컬 시간대로 포맷하지 마라. 이유: 서버 시간대에 따라 날짜가 하루 밀린다. 일련번호를 시간대 없이 연·월·일로 풀어라 (SheetJS의 `SSF.is_date`, `SSF.parse_date_code`를 쓸 수 있다).
6. **시트 선택**: 내용이 있는 첫 번째 시트만 읽는다.
7. **정리**: 모든 셀은 앞뒤 공백을 없앤 문자열이다. 빈 셀은 `""`이다. 모든 셀이 빈 행은 버린다.
8. **오류 문구**:
   - 내용이 하나도 없으면 `ParseError("파일에 내용이 없어요.")`
   - 비밀번호가 걸린 파일이면 `ParseError("비밀번호가 걸린 파일은 읽을 수 없어요. 비밀번호를 해제한 뒤 다시 올려 주세요.")`
   - 그 밖에 SheetJS가 읽지 못하면 `ParseError("파일을 읽지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.")`
   - SheetJS의 원래 예외 메시지를 사용자 문구에 섞지 마라.

### 3. 테스트 (`src/lib/parser/read-sheet.test.ts`)

- 파일 첫 줄에 `// @vitest-environment node`를 둔다.
- fixture 파일을 저장소에 추가하지 말고 테스트 안에서 만든다. xlsx와 xls는 SheetJS의 `utils.aoa_to_sheet`와 `write`(`type: "array"`, `bookType: "xlsx"` 또는 `"biff8"`)로 만든다.
- 다뤄야 할 경우:
  - UTF-8 CSV, BOM이 붙은 UTF-8 CSV
  - EUC-KR CSV. 아래 바이트는 `거래일자,가맹점명,이용금액\n2026-09-01,스타벅스,4500\n`을 EUC-KR로 인코딩한 것이다. 결과는 `[["거래일자","가맹점명","이용금액"],["2026-09-01","스타벅스","4500"]]`이어야 한다.

    ```ts
    const EUC_KR_CSV = new Uint8Array([
      0xb0, 0xc5, 0xb7, 0xa1, 0xc0, 0xcf, 0xc0, 0xda, 0x2c, 0xb0, 0xa1, 0xb8,
      0xcd, 0xc1, 0xa1, 0xb8, 0xed, 0x2c, 0xc0, 0xcc, 0xbf, 0xeb, 0xb1, 0xdd,
      0xbe, 0xd7, 0x0a, 0x32, 0x30, 0x32, 0x36, 0x2d, 0x30, 0x39, 0x2d, 0x30,
      0x31, 0x2c, 0xbd, 0xba, 0xc5, 0xb8, 0xb9, 0xf7, 0xbd, 0xba, 0x2c, 0x34,
      0x35, 0x30, 0x30, 0x0a,
    ]);
    ```
  - 따옴표로 감싼 `"1,234"` 셀은 `1,234` 한 칸이다. `0012`와 `2026.09.01`은 그대로 남는다.
  - xlsx: 숫자 셀 `4500`은 `"4500"`. 날짜 셀은 일련번호로 직접 만든다. `{ t: "n", v: 46266, z: "yyyy-mm-dd" }`는 `"2026-09-01"`, `{ t: "n", v: 46266.604166666664, z: "yyyy-mm-dd hh:mm:ss" }`는 `"2026-09-01 14:30:00"`. 표시 형식을 `m/d/yy`로 바꿔도 결과가 같아야 한다.
  - xls(biff8): 한글 문자열과 숫자 셀이 그대로 읽힌다.
  - `.xls` 이름의 HTML 표(`<table><tr><td>…`)가 표로 읽히고 `1,234` 같은 셀이 문자열로 남는다.
  - 첫 시트가 비어 있고 둘째 시트에 내용이 있으면 둘째 시트를 읽는다.
  - 빈 행은 결과에서 빠진다.
  - `.pdf` 같은 확장자, 0바이트 파일, `.xlsx` 이름의 무작위 바이트는 각각 정해진 문구의 `ParseError`.

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY npm run build
npm run test
TZ=America/Los_Angeles npx vitest run src/lib/parser
TZ=Asia/Seoul npx vitest run src/lib/parser
grep -q '"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"' package.json
test -f src/lib/parser/read-sheet.test.ts
! grep -rn "from \"xlsx\"\|from 'xlsx'" src --include="*.ts" --include="*.tsx" --exclude="*.test.ts" --exclude="*.test.tsx" | grep -v "^src/lib/parser/"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/1-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (파일 경로, export 이름, 셀 값 규칙, 설치한 패키지를 적는다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트와 API 키는 이 step에 필요하지 않다. 키가 없다는 이유로 `blocked` 처리하지 마라.

## 금지사항

- `npm install xlsx`로 npm 레지스트리 버전을 설치하지 마라. 이유: 레지스트리의 0.18.5에는 고쳐지지 않은 취약점이 있다 (ADR-013).
- papaparse, iconv-lite, exceljs 같은 다른 파싱·인코딩 라이브러리를 추가하지 마라. 이유: SheetJS와 Node 내장 `TextDecoder`로 충분하다.
- 열의 의미(날짜, 금액, 가맹점)를 해석하지 마라. 이유: step 2 범위다.
- 파일을 디스크에 쓰거나 Supabase Storage에 올리지 마라. 이유: 원본 파일은 저장하지 않는다.
- 옛 `.xls`(BIFF5)의 코드페이지 지원을 위한 `cpexcel` 등록을 넣지 마라. 이유: 실제 파일로 확인한 뒤 Phase 3에서 다룬다.
- API 라우트나 업로드 UI를 만들지 마라. 이유: step 8, 9 범위다.
- 기존 테스트를 깨뜨리지 마라.
