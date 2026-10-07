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

받는 확장자와 그 안내 문구는 `file-rules.ts`에 따로 둔다. step 8의 업로드 검증(`validateUploadFile`)이 같은 값을 쓰고, 그 검증은 step 9의 클라이언트 컴포넌트에서도 호출된다.

구현 파일보다 테스트 파일을 먼저 작성하라.

### 1. SheetJS 설치

```bash
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

`package.json`의 dependencies에 `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`가 들어가야 한다. 네트워크 문제로 설치가 안 되면 `blocked`로 기록하고 중단하라.

### 2. `src/lib/parser/file-rules.ts`

```ts
export const SUPPORTED_EXTENSIONS = [".csv", ".xlsx", ".xls"] as const;
export const UNSUPPORTED_FORMAT_MESSAGE = "지원하지 않는 파일 형식이에요. CSV 또는 Excel(.xlsx, .xls) 파일을 올려 주세요.";
export const EMPTY_FILE_MESSAGE = "파일에 내용이 없어요.";

// 파일 이름이 SUPPORTED_EXTENSIONS 중 하나로 끝나면 true. 대소문자를 가리지 않는다.
export function hasSupportedExtension(fileName: string): boolean;
```

- 받는 확장자 목록과 두 문구의 원본은 이 파일 하나다. `readSheet`는 이 상수로 `ParseError`를 던지고, step 8의 `validateUploadFile`은 같은 상수를 돌려준다. `read-sheet.ts`에 확장자 목록이나 이 문구를 다시 적지 마라. 이유: 원본이 둘이면 같은 파일을 두고 화면의 검증과 서버의 파서가 서로 다른 안내를 하게 된다.
- 이 파일에서 `xlsx`, `node:*`, `read-sheet`를 import 하지 마라. 이유: `validateUploadFile`은 클라이언트 컴포넌트에서도 호출된다. SheetJS나 Node 전용 모듈이 딸려 가면 브라우저 번들에 들어가거나 빌드가 깨진다.

### 3. `src/lib/parser/read-sheet.ts`

```ts
export type SheetGrid = string[][];

// message는 사용자에게 그대로 보여 주는 한국어 문구다.
export class ParseError extends Error {}

export const MAX_INFLATED_BYTES = 20 * 1024 * 1024;
export const MAX_SHEETS = 20;

// ZIP의 엔트리들을 푼 크기의 합(엔트리 하나는 적어도 256KB로 센다)이 limit 바이트를 넘거나,
// ZIP 구조를 읽을 수 없거나 헤더에 적힌 크기가 실제와 다르면 ParseError를 던진다.
export function assertZipWithinLimit(data: Uint8Array, limit: number): void;

// 실패하면 ParseError를 던진다. 디스크와 네트워크를 건드리지 않는 순수 함수다.
export function readSheet(data: Uint8Array, fileName: string): SheetGrid;
```

규칙:

1. **확장자**: `hasSupportedExtension(fileName)`이 false면 `ParseError(UNSUPPORTED_FORMAT_MESSAGE)`. 확장자는 받을 파일을 가리는 데만 쓴다. 읽는 방식은 확장자로 정하지 않는다.
2. **형식 판별**: 읽는 방식은 파일의 앞쪽 바이트로 정한다. 세 확장자 모두 같은 규칙을 따른다.
   - 0바이트면 `ParseError(EMPTY_FILE_MESSAGE)`.
   - `50 4B 03 04`(ZIP, 곧 xlsx)나 `D0 CF 11 E0 A1 B1 1A E1`(OLE2, 곧 옛 xls)로 시작하면 바이너리로 SheetJS에 넘긴다.
   - 그 밖은 모두 텍스트(CSV, 탭으로 나눈 텍스트, HTML 표)로 읽는다.
   - 이유: 국내 은행은 탭이나 쉼표로 나눈 EUC-KR 텍스트와 HTML 표를 `.xls` 이름으로 내려 준다. 이런 바이트를 바이너리로 SheetJS에 넘기면 글자가 깨진 표가 나온다.
3. **텍스트 디코딩**: 맨 앞의 BOM부터 본다. `EF BB BF`로 시작하면 UTF-8(`new TextDecoder("utf-8")`), `FF FE`로 시작하면 UTF-16LE(`new TextDecoder("utf-16le")`), `FE FF`로 시작하면 UTF-16BE(`new TextDecoder("utf-16be")`)로 디코딩한다. 이유: Excel에서 "유니코드 텍스트"로 저장한 파일은 BOM이 붙은 UTF-16LE다. 이런 바이트를 UTF-8이나 EUC-KR로 읽으면 숫자와 탭마다 붙은 `00` 바이트가 U+0000으로 남아, 멀쩡한 파일이 손상된 파일로 거부된다. BOM이 없으면 먼저 UTF-8로 엄격하게 디코딩한다(`new TextDecoder("utf-8", { fatal: true })`). 실패하면 EUC-KR로 디코딩한다(`new TextDecoder("euc-kr")`). BOM은 제거한다. 텍스트로 판별된 입력은 모두 같은 디코딩 함수를 쓴다. 디코딩한 문자열에 U+0000 문자가 들어 있으면 `ParseError("파일을 읽지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.")`. 이유: SheetJS는 아무 바이트나 받아도 예외를 던지지 않고 뜻 없는 표를 돌려주므로, 텍스트가 아닌 입력은 직접 걸러야 한다. 그 뒤에 문자열을 SheetJS에 넘긴다.
4. **탭으로 나눈 텍스트**: 디코딩한 문자열에서 공백 문자만 있는 줄을 건너뛰고 앞에서부터 30줄을 본다. 그중 한 줄에라도 탭 문자가 있으면, SheetJS `read`의 옵션 `FS: "\t"`를 줘서 탭을 구분자로 읽는다. 그 밖에는 `FS`를 주지 않는다. 이유: 구분자를 정해 주지 않으면 SheetJS는 앞부분에 나온 쉼표와 탭의 개수를 세어 많은 쪽을 고르고, 개수가 같으면 쉼표를 고른다. 탭으로 나눈 파일에 `1,234,000`처럼 천 단위 쉼표가 든 금액이 있으면 쉼표가 탭만큼 또는 더 많이 나와 행이 쉼표에서 잘린다. 반대로 쉼표로 나눈 파일에 `FS: "\t"`를 주면 한 줄이 통째로 한 칸이 된다. 첫 줄만 보지 않고 30줄을 보는 것은, 머리글 위에 안내 문구 한 줄이 있는 탭 파일에서 첫 줄에 탭이 없기 때문이다. 30줄은 step 2가 머리글을 찾는 범위와 같다. 받아들이는 비용: 앞 30줄 안의 어떤 칸에 탭이 들어 있는 쉼표 CSV는 탭으로 나뉘어 읽힌다. HTML 표를 읽을 때는 SheetJS가 `FS`를 쓰지 않으므로 HTML인지 따로 가려낼 필요가 없다.
5. **ZIP 크기 제한**: ZIP으로 판별된 바이트는 SheetJS에 넘기기 전에 `assertZipWithinLimit(data, MAX_INFLATED_BYTES)`를 호출한다. 이유: xlsx는 ZIP이라 4MB짜리 파일도 풀면 수 GB가 될 수 있고, SheetJS는 행 수를 따지기 전에 모든 엔트리를 메모리에 푼다. 검사 방법은 아래 "`assertZipWithinLimit` 규칙"을 따른다.
6. **셀 값은 문자열 그대로**: 텍스트 형식(CSV, 탭으로 나눈 텍스트, HTML)의 셀은 SheetJS가 숫자나 날짜로 해석하지 못하게 하라. `0012`가 `12`로, `2026.09.01`이 다른 모양으로 바뀌면 안 된다.
7. **바이너리 형식의 셀**:
   - 숫자 셀은 표시 형식과 상관없이 실제 값의 문자열이다 (`4500`, 천 단위 쉼표 없음).
   - 날짜 셀은 표시 형식과 상관없이 `YYYY-MM-DD`이고, 시각이 있으면 `YYYY-MM-DD HH:mm:ss`다.
   - 다만 값이 0 이상 1 미만인 날짜 셀은 날짜 없이 시각만 든 셀이다. 표시 형식과 상관없이 `HH:mm:ss`다 (`0.6041666666666666` → `14:30:00`). 이유: 시각이 `거래시간` 같은 별도 열에 들어 있는 파일이 있고, step 2가 그 열에서 시각을 읽는다.
   - 날짜 셀을 JS `Date`로 바꿨다가 로컬 시간대로 포맷하지 마라. 이유: 서버 시간대에 따라 날짜가 하루 밀린다. 일련번호를 시간대 없이 연·월·일로 풀어라 (SheetJS의 `SSF.is_date`, `SSF.parse_date_code`를 쓸 수 있다).
8. **시트 선택**: 워크북의 모든 시트를 한 번에 만들지 말고, 내용이 있는 첫 시트만 만든다.
   - **바이너리 형식**:
     - 바이트는 `Buffer.from(data.buffer, data.byteOffset, data.byteLength)`로 감싸 SheetJS에 `type: "buffer"`로 넘긴다. 이유: SheetJS는 `Uint8Array`를 받으면 deflate 엔트리를 풀 때마다 그 지점부터 파일 끝까지를 복사한다. 엔트리가 많은 xlsx에서는 이 복사가 쌓여(엔트리 80개짜리 4MB 파일에서 100MB를 넘는다) 금방 메모리를 쓴다. 같은 메모리를 가리키는 `Buffer` 뷰를 주면 복사하지 않는다 (4MB 파일 기준 100MB 대 0.1MB).
     - 먼저 `bookSheets: true`로 읽어 시트 이름만 가져온다. 시트 수가 `MAX_SHEETS`를 넘으면 `ParseError("파일을 읽지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.")`. 이유: 워크북은 같은 시트 조각을 여러 번 가리킬 수 있어, 파일과 압축을 푼 크기는 작아도 전부 읽으면 비용이 시트 수만큼 곱해진다. 2만 행짜리 시트 하나를 20번 가리키는 300KB짜리 xlsx를 통째로 읽으면 셀 120만 개에 수백 MB를 쓴다. `bookSheets: true` 읽기는 셀을 만들지 않아 싸다.
     - 그다음 `i`를 0부터 시트 수 − 1까지 돌며 `sheets: i` 옵션으로 한 시트씩 읽어, 내용이 있는 첫 시트의 표를 돌려준다. 이유: xlsx는 이 옵션을 지켜 그 시트 하나만 셀로 만들므로, 위의 곱셈이 일어나지 않는다. biff8(옛 `.xls`)은 이 옵션을 무시하고 한 번에 모든 시트를 만들지만, `.xls`의 각 시트는 파일 안의 서로 다른 바이트 구간이라 비용이 4MB 상한 안에 묶이고, 같은 구간을 가리키는 중복 시트 레코드는 하나로 합쳐진다. 그래서 biff8은 `i = 0` 읽기 한 번으로 내용이 있는 첫 시트를 찾아 끝난다.
   - **텍스트 형식**: 한 번 읽어 내용이 있는 첫 시트(HTML에서는 첫 표)를 쓴다. 이유: SheetJS는 텍스트·HTML에는 `sheets`/`bookSheets`를 쓰지 않지만, 비용이 디코딩한 텍스트 크기(4MB 상한)에 묶여 시트 수만큼 부풀지 않는다. 표가 수만 개인 4MB HTML도 한 번 읽는 데 수백 MB 안쪽이다.
   - 첫 시트가 비어 있고 둘째 시트에 내용이 있으면 둘째 시트를 읽는다. 내용이 있는 시트가 하나도 없으면 `ParseError(EMPTY_FILE_MESSAGE)`.
9. **정리**: 모든 셀은 앞뒤 공백을 없앤 문자열이다. 빈 셀은 `""`이다. 모든 셀이 빈 행은 버린다.
10. **오류 문구**:
    - 받지 않는 확장자면 `ParseError(UNSUPPORTED_FORMAT_MESSAGE)`
    - 0바이트이거나, 읽었는데 내용이 하나도 없으면 `ParseError(EMPTY_FILE_MESSAGE)`
    - ZIP을 푼 크기가 한도를 넘으면 `ParseError("파일 내용이 너무 커요. 기간을 나눠서 올려 주세요.")`
    - 비밀번호가 걸린 파일이면 `ParseError("비밀번호가 걸린 파일은 읽을 수 없어요. 비밀번호를 해제한 뒤 다시 올려 주세요.")`
    - 텍스트에 U+0000이 있거나, ZIP 구조를 읽을 수 없거나 헤더에 적힌 크기가 실제와 다르거나, 시트 수가 `MAX_SHEETS`를 넘거나, 그 밖에 SheetJS가 읽지 못하면 `ParseError("파일을 읽지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.")`
    - SheetJS와 `node:zlib`의 원래 예외 메시지를 사용자 문구에 섞지 마라.

`assertZipWithinLimit` 규칙:

- ZIP 구조에서 아래 값만 직접 읽는다. 값은 모두 리틀 엔디언이고, 오프셋은 각 레코드의 시작 기준이다.

  | 레코드 | 시그니처 | 읽는 값 (오프셋, 바이트 수) |
  |---|---|---|
  | EOCD (End of Central Directory, 22바이트 + 주석) | `50 4B 05 06` | 엔트리 수 (8, 2), 전체 엔트리 수 (10, 2), 중앙 디렉터리 시작 위치 (16, 4) |
  | 중앙 디렉터리 엔트리 (46바이트 + 이름 + extra + 주석) | `50 4B 01 02` | 압축 방식 (10, 2), 압축 크기 (20, 4), 압축을 푼 크기 (24, 4), 이름 길이 (28, 2), extra 길이 (30, 2), 주석 길이 (32, 2), 로컬 헤더 위치 (42, 4) |
  | 로컬 헤더 (30바이트 + 이름 + extra) | `50 4B 03 04` | 플래그 (6, 2), 압축 방식 (8, 2), 압축 크기 (18, 4), 압축을 푼 크기 (22, 4), 이름 길이 (26, 2), extra 길이 (28, 2) |
  | extra 안의 레코드 (4바이트 + 내용) | 없음 | ID (0, 2), 내용 길이 (2, 2) |

- EOCD는 파일의 마지막 4바이트 자리에서 앞쪽으로 훑어 처음 만나는 시그니처로 정한다. 그 자리부터 22바이트가 버퍼 안에 다 들어 있어야 한다.
- EOCD의 엔트리 수만큼 중앙 디렉터리 엔트리를 시작 위치부터 차례로 읽는다. 엔트리마다 로컬 헤더를 찾아간다. 압축된 바이트는 `로컬 헤더 위치 + 30 + 로컬 헤더의 이름 길이 + 로컬 헤더의 extra 길이`에서 시작하고, 길이는 중앙 디렉터리의 압축 크기다.
- 엔트리마다 실제 크기를 잰다. 압축 방식이 0(저장)이면 중앙 디렉터리의 압축 크기가 실제 크기다.
- 압축 방식이 8(deflate)이면 압축된 바이트를 `node:zlib`의 `inflateRawSync`로 풀어 나온 길이가 실제 크기다. 옵션 `maxOutputLength`에 `limit - 지금까지의 합계 + 1`을 준다. 이유: 한도를 넘는 순간 푸는 일이 멈춘다. 전부 푼 뒤에 길이를 재면 재기도 전에 메모리가 찬다. `+ 1`을 빼면 남은 한도가 0일 때 Node가 옵션 범위 오류를 낸다 (1 이상이어야 한다).
- 엔트리마다 실제 크기와 `256 * 1024` 중 큰 쪽을 합계에 더한다. 이유: SheetJS는 엔트리 하나를 읽을 때마다 내용의 크기와 상관없이 메모리를 쓴다. 로컬 헤더의 압축을 푼 크기가 0인 deflate 엔트리는 256KB짜리 버퍼부터 잡고, 엔트리의 이름(최대 64KB)은 문자열로 만들어 끝까지 들고 있다. 실제 크기만 더하면 내용이 빈 엔트리 수천 개로 된 수백 KB짜리 파일이 합계 0으로 통과하고, SheetJS는 그 파일에 수백 MB를 쓴다.
- 합계가 `limit`을 넘거나 `inflateRawSync`가 `code`가 `ERR_BUFFER_TOO_LARGE`인 예외를 던지면 `ParseError("파일 내용이 너무 커요. 기간을 나눠서 올려 주세요.")`.
- 아래 경우는 모두 `ParseError("파일을 읽지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.")`:
  - EOCD 시그니처가 없다.
  - 레코드나 압축된 바이트의 범위가 버퍼를 벗어난다.
  - 중앙 디렉터리 엔트리나 로컬 헤더의 자리에 시그니처가 없다.
  - EOCD의 엔트리 수와 전체 엔트리 수가 다르다.
  - 로컬 헤더의 압축 방식이 중앙 디렉터리의 압축 방식과 다르다.
  - 압축 크기, 압축을 푼 크기, 로컬 헤더 위치, 중앙 디렉터리 시작 위치 중 하나가 `0xFFFFFFFF`다 (ZIP64 표시).
  - 압축 방식이 0도 8도 아니다.
  - `inflateRawSync`가 크기 한도가 아닌 이유로 실패한다.
  - 중앙 디렉터리의 압축을 푼 크기가 실제 크기와 다르다.
  - 로컬 헤더의 압축 크기나 압축을 푼 크기가 중앙 디렉터리의 값과 다르다. 다만 압축 방식이 8이고 로컬 헤더 플래그의 bit 3(`0x0008`, 크기를 내용 뒤에 따로 적는다는 표시)이 켜져 있으면 로컬 헤더의 값은 0이어도 된다. 이유: 크기를 모르는 채로 로컬 헤더부터 써야 하는 스트림 출력은 로컬 헤더의 두 크기에 0을 적고 bit 3을 켠 뒤, 실제 크기를 중앙 디렉터리에 적는다. Java나 Python이 스트림에 쓴 xlsx가 이런 모양이라 받아야 한다.
  - 중앙 디렉터리 엔트리나 로컬 헤더의 extra에 ID가 `0x0001`인 레코드(ZIP64 확장 정보)가 있다. extra는 `ID + 내용 길이 + 내용`인 레코드가 이어진 것이다. 처음부터 레코드를 하나씩 건너가며 ID를 보고, 남은 바이트가 4보다 적으면 멈춘다. 중앙 디렉터리 엔트리의 extra는 `엔트리 시작 + 46 + 이름 길이`에서, 로컬 헤더의 extra는 `로컬 헤더 위치 + 30 + 로컬 헤더의 이름 길이`에서 시작한다. 이유: SheetJS는 이 레코드가 있으면 그 안에 적힌 크기를 헤더의 크기 대신 쓴다. 4GB가 넘는 파일을 위한 확장이라 여기서 받는 크기의 파일에는 필요가 없다.
- 헤더에 적힌 압축을 푼 크기를 합계에 쓰지 마라. 이유: 파일을 만든 쪽이 마음대로 적을 수 있는 값이다. 실제로 풀어서 잰다. 헤더의 크기는 실제 크기와 맞는지 확인하는 데만 쓴다.
- 헤더에 적힌 크기가 실제 크기와 맞는지 확인하는 이유: SheetJS는 deflate 엔트리를 풀기 전에 로컬 헤더에 적힌 압축을 푼 크기만큼 버퍼를 먼저 잡고, 저장 엔트리는 로컬 헤더에 적힌 압축 크기만큼 잘라 낸다 (`node_modules/xlsx/xlsx.mjs`의 `parse_local_file`, `inflate`). 실제 크기만 재고 이 값을 확인하지 않으면, 몇 KB짜리 파일이 검사를 통과한 뒤 SheetJS에게 수백 MB를 잡게 한다.
- EOCD의 위치, 엔트리 수, 압축 방식을 위에 적은 자리에서 읽고 서로 맞는지 확인하는 이유: SheetJS는 파일 끝에서부터 찾은 EOCD의 엔트리 수(오프셋 8)만큼 엔트리를 읽고, 압축 방식과 데이터의 위치는 로컬 헤더를 따른다 (`node_modules/xlsx/xlsx.mjs`의 `parse_zip`, `parse_local_file`). 검사가 다른 자리의 값만 믿으면, 검사는 통과하는데 SheetJS는 훨씬 큰 내용을 푸는 파일을 만들 수 있다.

### 4. 테스트 (`src/lib/parser/file-rules.test.ts`)

- 파일 첫 줄에 `// @vitest-environment node`를 둔다.
- `SUPPORTED_EXTENSIONS`는 `[".csv", ".xlsx", ".xls"]`다.
- `hasSupportedExtension`: `a.csv`, `a.xlsx`, `a.xls`, `내역.CSV`, `A.Xlsx`는 true. `a.pdf`, `a.xlsx.pdf`, 점이 없는 `xlsx`, 빈 문자열은 false.
- `UNSUPPORTED_FORMAT_MESSAGE`와 `EMPTY_FILE_MESSAGE`가 위에 적은 문자열과 같다.

### 5. 테스트 (`src/lib/parser/read-sheet.test.ts`)

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
  - 같은 `EUC_KR_CSV` 바이트를 `a.xls` 이름으로 넘겨도 `a.csv`일 때와 같은 표가 나온다.
  - `.xls` 이름의 탭 구분 UTF-8 텍스트 `거래일자\t가맹점명\t이용금액\n2026-09-01\t스타벅스\t4500\n`이 `[["거래일자","가맹점명","이용금액"],["2026-09-01","스타벅스","4500"]]`로 읽힌다.
  - `.xls` 이름의 탭 구분 UTF-8 텍스트 `거래일자\t이용금액\n2026-09-01\t1,234,000\n`이 `[["거래일자","이용금액"],["2026-09-01","1,234,000"]]`로 읽힌다 (따옴표 없이 쉼표가 든 금액이 한 칸으로 남는다).
  - 머리글 위에 안내 줄이 있는 탭 텍스트 `카드 이용내역\n\n거래일자\t이용금액\n2026-09-01\t1,234,000\n`이 탭으로 나뉘어 읽힌다 (첫 줄에 탭이 없어도 30줄 안에 있으면 탭 구분이다). 안내 줄은 한 칸짜리 행으로 남고, 금액 칸은 `1,234,000` 그대로다.
  - BOM이 붙은 UTF-16LE 텍스트: `Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("거래일자\t금액\n2026-09-01\t4500\n", "utf16le")])`를 `a.xls` 이름으로 넘기면 `[["거래일자","금액"],["2026-09-01","4500"]]`이다. 그 바이트를 복사한 뒤 `swap16()`으로 바이트 순서를 뒤집은 UTF-16BE(`FE FF`로 시작한다)도 같은 표가 나온다.
  - 따옴표로 감싼 `"1,234"` 셀은 `1,234` 한 칸이다. `0012`와 `2026.09.01`은 그대로 남는다.
  - xlsx: 숫자 셀 `4500`은 `"4500"`. 날짜 셀은 일련번호로 직접 만든다. `{ t: "n", v: 46266, z: "yyyy-mm-dd" }`는 `"2026-09-01"`, `{ t: "n", v: 46266.604166666664, z: "yyyy-mm-dd hh:mm:ss" }`는 `"2026-09-01 14:30:00"`. 표시 형식을 `m/d/yy`로 바꿔도 결과가 같아야 한다.
  - xlsx: 시각만 있는 셀 `{ t: "n", v: 0.6041666666666666, z: "hh:mm:ss" }`는 `"14:30:00"`. 표시 형식을 `h:mm`으로 바꿔도 결과가 같아야 한다.
  - xls(biff8): 한글 문자열과 숫자 셀이 그대로 읽힌다.
  - `.xls` 이름의 HTML 표(`<table><tr><td>…`)가 표로 읽히고 `1,234` 같은 셀이 문자열로 남는다.
  - 첫 시트가 비어 있고 둘째 시트에 내용이 있으면 둘째 시트를 읽는다. xlsx와 biff8 모두 확인한다.
  - 시트 수: 시트 `MAX_SHEETS`개로 만든 워크북은 첫 시트의 표가 나오고, 시트 `MAX_SHEETS + 1`개로 만든 워크북은 `파일을 읽지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.`의 `ParseError`다. xlsx(`bookType: "xlsx"`)와 biff8(`bookType: "biff8"`) 모두 확인한다.
  - 빈 행은 결과에서 빠진다.
  - `.pdf` 같은 확장자는 `UNSUPPORTED_FORMAT_MESSAGE`, 0바이트 파일은 `EMPTY_FILE_MESSAGE`의 `ParseError`.
  - `new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00])`를 `a.xlsx` 이름으로 넘기면 `파일을 읽지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.`의 `ParseError` (시그니처가 없고 NUL이 들어 있다).
  - `new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])`를 `a.xlsx` 이름으로 넘겨도 같은 오류다 (ZIP 시그니처만 있다).
  - `assertZipWithinLimit`: `write`에 `compression: true`를 줘서 만든 xlsx는 한도 `10 * 1024 * 1024`에서 통과하고, 한도 `100`에서는 `파일 내용이 너무 커요. 기간을 나눠서 올려 주세요.`의 `ParseError`를 던진다. `compression` 없이 만든 xlsx도 똑같다.
  - `assertZipWithinLimit`: 위의 두 xlsx 각각에서 EOCD의 엔트리 수(오프셋 8부터 2바이트)를 `n`이라 하면, 한도 `n * 256 * 1024`에서는 통과하고 한도 `n * 256 * 1024 - 1`에서는 `파일 내용이 너무 커요. 기간을 나눠서 올려 주세요.`의 `ParseError`를 던진다 (작은 엔트리도 256KB로 센다).
  - `assertZipWithinLimit`: `compression: true`로 만든 xlsx의 바이트를 아래처럼 바꾸면 한도 `10 * 1024 * 1024`에서도 `파일을 읽지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.`의 `ParseError`를 던진다. 아래 경우를 각각 따로 확인한다. SheetJS가 쓴 xlsx는 마지막 22바이트가 EOCD다. 첫 중앙 디렉터리 엔트리는 EOCD의 오프셋 16에서 읽은 위치에 있고, 첫 로컬 헤더는 첫 중앙 디렉터리 엔트리의 오프셋 42에서 읽은 위치에 있다.
    - 첫 중앙 디렉터리 엔트리의 압축 방식을 0으로 바꾼 것 (EOCD의 오프셋 16에서 읽은 위치 + 10부터 2바이트). 로컬 헤더에는 8이 남는다.
    - EOCD의 전체 엔트리 수를 0으로 바꾼 것 (EOCD의 오프셋 10부터 2바이트).
    - 첫 로컬 헤더의 압축을 푼 크기를 `1000000`으로 바꾼 것 (오프셋 22부터 4바이트).
    - 첫 중앙 디렉터리 엔트리의 압축을 푼 크기를 `1000000`으로 바꾼 것 (오프셋 24부터 4바이트).
    - 위의 두 값을 함께 `1000000`으로 바꾼 것. 두 헤더의 값이 서로 같아도 실제로 푼 크기와 다르면 거부해야 한다. 이 바이트를 `readSheet`에 `a.xlsx` 이름으로 넘겨도 같은 오류다.
    - 첫 로컬 헤더의 압축 크기와 압축을 푼 크기를 0으로 바꾼 것 (오프셋 18부터 8바이트). 플래그는 그대로 둔다.
    - 첫 로컬 헤더의 이름 길이를 4만큼 줄이고 (오프셋 26부터 2바이트) extra 길이를 4로 바꾼 뒤 (오프셋 28부터 2바이트), 원래 이름의 마지막 4바이트를 `01 00 00 00`으로 덮어쓴 것. 데이터가 시작하는 자리는 그대로이고, 이름의 끝 4바이트가 ID `0x0001`에 내용 길이 0인 extra 레코드가 된다.
    - 첫 중앙 디렉터리 엔트리를 같은 방법으로 바꾼 것 (이름 길이는 오프셋 28부터 2바이트, extra 길이는 오프셋 30부터 2바이트, 이름은 오프셋 46에서 시작한다).
  - `assertZipWithinLimit`: `compression: true`로 만든 xlsx에서 첫 로컬 헤더의 플래그를 `0x0008`로 바꾸고 (오프셋 6부터 2바이트) 압축 크기와 압축을 푼 크기를 0으로 바꾼 것은 한도 `10 * 1024 * 1024`에서 통과한다 (스트림에 쓴 xlsx의 로컬 헤더 모양이다).
  - `assertZipWithinLimit`: `compression` 없이 만든 xlsx에서 첫 로컬 헤더의 압축 크기를 0으로 바꾸면 (오프셋 18부터 4바이트) 한도 `10 * 1024 * 1024`에서 `파일을 읽지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.`의 `ParseError`를 던진다. 플래그를 `0x0008`로 함께 바꿔도 같은 오류다 (저장 엔트리는 0을 허용하지 않는다).

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY npm run build
npm run test
TZ=America/Los_Angeles npx vitest run src/lib/parser
TZ=Asia/Seoul npx vitest run src/lib/parser
grep -q '"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"' package.json
test -f src/lib/parser/read-sheet.test.ts && test -f src/lib/parser/file-rules.test.ts
! grep -rn "from \"xlsx\"\|from 'xlsx'" src --include="*.ts" --include="*.tsx" --exclude="*.test.ts" --exclude="*.test.tsx" | grep -v "^src/lib/parser/"
! grep -n "from \"xlsx\"\|from 'xlsx'\|from \"node:\|from 'node:\|read-sheet\"\|read-sheet'" src/lib/parser/file-rules.ts
grep -q "hasSupportedExtension" src/lib/parser/read-sheet.ts
! grep -n "지원하지 않는 파일 형식\|파일에 내용이 없어요" src/lib/parser/read-sheet.ts
grep -q "inflateRawSync" src/lib/parser/read-sheet.ts
grep -q "maxOutputLength" src/lib/parser/read-sheet.ts
grep -qi "utf-16le" src/lib/parser/read-sheet.ts
grep -qi "utf-16be" src/lib/parser/read-sheet.ts
grep -qw "FS" src/lib/parser/read-sheet.ts
grep -q "MAX_SHEETS" src/lib/parser/read-sheet.ts
grep -q "bookSheets" src/lib/parser/read-sheet.ts
grep -q "Buffer.from" src/lib/parser/read-sheet.ts
grep -q "1,234,000" src/lib/parser/read-sheet.test.ts
grep -q "0.6041666666666666" src/lib/parser/read-sheet.test.ts
grep -q "MAX_SHEETS" src/lib/parser/read-sheet.test.ts
! grep -q '"jszip"\|"fflate"\|"adm-zip"\|"yauzl"\|"unzipper"\|"pako"' package.json
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/1-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (파일 경로, export 이름, 형식 판별 규칙, 텍스트 인코딩과 구분자 규칙, 셀 값 규칙과 날짜·시각 셀의 모양, ZIP 크기 한도와 엔트리당 최소 크기, 시트 수 상한과 한 시트씩 읽는 방식, 설치한 패키지를 적는다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트와 API 키는 이 step에 필요하지 않다. 키가 없다는 이유로 `blocked` 처리하지 마라.

## 금지사항

- `npm install xlsx`로 npm 레지스트리 버전을 설치하지 마라. 이유: 레지스트리의 0.18.5에는 고쳐지지 않은 취약점이 있다 (ADR-013).
- papaparse, iconv-lite, exceljs 같은 다른 파싱·인코딩 라이브러리를 추가하지 마라. 이유: SheetJS와 Node 내장 `TextDecoder`로 충분하다.
- jszip, fflate, adm-zip 같은 압축 해제 라이브러리를 추가하지 마라. 이유: ZIP 크기 검사는 Node 내장 `node:zlib`로 충분하다.
- 탭으로 나눈 텍스트를 직접 `split`으로 자르거나 탭을 쉼표로 바꿔서 SheetJS에 넘기지 마라. 이유: 따옴표로 감싼 칸과 쉼표가 든 칸이 깨진다. SheetJS의 `FS` 옵션으로 읽는다.
- 바이너리 파일의 모든 시트를 한 번에 만들지 마라(`sheets`나 `bookSheets` 없이 `XLSX.read` 한 번으로 워크북 전체를 읽지 마라). 이유: 워크북이 같은 시트 조각을 여러 번 가리키면 작은 파일도 비용이 시트 수만큼 곱해진다. 시트 수를 먼저 세어 막고, 한 시트씩 읽는다.
- 바이너리 파일의 바이트를 `Uint8Array` 그대로 `XLSX.read`에 넘기지 마라. 이유: SheetJS가 deflate 엔트리마다 남은 바이트를 복사한다. `Buffer.from(data.buffer, data.byteOffset, data.byteLength)` 뷰로 넘긴다.
- 열의 의미(날짜, 금액, 가맹점)를 해석하지 마라. 이유: step 2 범위다.
- 파일을 디스크에 쓰거나 Supabase Storage에 올리지 마라. 이유: 원본 파일은 저장하지 않는다.
- 옛 `.xls`(BIFF5)의 코드페이지 지원을 위한 `cpexcel` 등록을 넣지 마라. 이유: 실제 파일로 확인한 뒤 Phase 3에서 다룬다.
- API 라우트나 업로드 UI를 만들지 마라. 이유: step 8, 9 범위다.
- 기존 테스트를 깨뜨리지 마라.
