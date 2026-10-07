---
name: review-code
description: FinSight의 변경 사항을 10개 차원으로 나눠 서브에이전트 4개가 동시에 리뷰하고 위험 단계별로 보고한다. 사용자가 `/review-code`를 실행하거나 차원별·병렬 코드 리뷰를 요청할 때 사용한다. 체크리스트 하나로 훑는 `/review`와는 다른 스킬이다.
argument-hint: "[기준 브랜치 또는 커밋, 기본 main | --staged]"
---

현재 체크아웃의 변경 사항을 10개 차원으로 리뷰한다. 리뷰는 서브에이전트 4개가 동시에 하고, 너는 대상을 정하고 결과를 합치는 일만 한다. 코드는 고치지 않고 보고만 한다.

기준: `$ARGUMENTS` (비어 있으면 `main`, `--staged`면 staged한 변경만)

## 1. 대상 계산

먼저 merge-base를 구한다.

```bash
git merge-base <기준> HEAD
```

출력된 해시를 넣어 변경 파일 목록을 구한다.

```bash
git diff --name-status <해시> && echo "--- untracked ---" && git ls-files --others --exclude-standard
```

두 명령을 그대로 쓴다. `$(…)` 치환, 변수, `git diff --merge-base`를 쓰면 훅과 CI의 헤드리스 실행에서 거부된다.

`git diff --name-status`는 merge-base 이후의 커밋과 커밋하지 않은 변경을 함께 보여 주고, `git ls-files --others`는 추적되지 않는 새 파일을 보여 준다. 둘 다 비어 있으면 "리뷰할 변경이 없습니다."라고 알리고 끝낸다. 서브에이전트를 띄우지 않는다.

기준이 `--staged`면 커밋하려고 staged한 변경만 본다. 위 명령 대신 아래를 실행한다. 추적되지 않는 파일은 대상이 아니다. 비어 있으면 위와 같이 알리고 끝낸다.

```bash
git diff --cached --name-status
```

## 2. 배정표

| 서브에이전트 | 맡는 차원 |
|---|---|
| `review-correctness` | correctness |
| `review-security` | security |
| `review-architecture` | architecture |
| `review-general` | privacy, test-coverage, conventions, cross-file, behavioral, performance, cpu-perf |

차원 이름은 `.claude/skills/review-code/layers/` 안의 체크리스트 파일 이름과 같다.

## 3. 실행

배정표의 서브에이전트 4개를 Agent 호출 4개로, **반드시 한 메시지에 담아** 동시에 띄운다. 하나씩 차례로 띄우지 않는다.

각 프롬프트에는 아래만 넣는다. diff 본문은 넣지 않는다. 리뷰어가 직접 읽는다.

```
merge-base: <해시>
맡은 차원: <배정표의 차원>
변경 파일:
<git diff --name-status 출력>
추적되지 않는 새 파일:
<git ls-files 출력, 없으면 "없음">
```

기준이 `--staged`면 첫 줄을 `merge-base: HEAD`로 쓰고 바로 아래에 `범위: staged` 줄을 더한다. 추적되지 않는 새 파일은 "없음"으로 적는다.

네 리뷰어의 보고가 모두 올 때까지 기다린다. 그동안 직접 리뷰하지 않는다. lint, build, test를 실행하지 않고 worktree를 만들지 않는다.

## 4. 취합

- 같은 줄의 같은 문제를 가리키는 중복 발견은 하나로 합친다. 단계가 다르면 높은 쪽을 쓰고 차원 이름을 둘 다 붙인다. 같은 줄이라도 문제가 다르면 따로 둔다.
- 그 밖에는 리뷰어가 매긴 단계를 바꾸지 않는다.
- 리뷰어 보고에 없는 발견을 더하지 않는다.
- 보고가 오지 않았거나 형식을 알아볼 수 없는 리뷰어의 차원은 ⚫ 리뷰 실패로 적는다. 🟢로 적지 않는다.

## 5. 출력 형식

아래 틀을 그대로 쓴다. 숫자와 내용은 예시다.

```
## 리뷰 결과: 🔴 위험 — 머지 금지
🔴 1 · 🟠 1 · 🟡 3    기준 main · 파일 12개

| #  | 차원          | 위험 | 건수 |
|----|---------------|------|------|
| 01 | correctness   | 🟠   | 1    |
| 02 | security      | 🔴   | 1    |
| 03 | performance   | 🟢   | 0    |
| 04 | conventions   | 🟡   | 1    |
| 05 | test coverage | 🟡   | 1    |
| 06 | architecture  | 🟡   | 1    |
| 07 | cross-file    | 🟢   | 0    |
| 08 | privacy       | 🟢   | 0    |
| 09 | CPU / perf    | 🟢   | 0    |
| 10 | behavioral    | ⚪   | -    |

### 🔴 위험 (1)
**[security] 클라이언트에서 Supabase 직접 호출**
`src/components/upload/form.tsx:14`
> const supabase = createBrowserClient(…)
이유: 외부 서비스 호출은 서버 전용 (CRITICAL)
수정: 서버 액션으로 옮긴다

### 🟠 경고 (1)
**[correctness] 합계에 이체가 포함됨**
`src/lib/aggregate/total.ts:31`
> …
이유: …
수정: …

### 🟡 주의 (3)
- [test-coverage] `src/lib/parse/row.ts:40` — 음수 금액 케이스 없음 — 테스트 추가
- [architecture] `src/app/dashboard/page.tsx:22` — 페이지에 집계 로직 — `src/lib/`로 이동
- [conventions] `src/lib/parse/row.ts:8` — 함수명 `doIt` — 하는 일을 드러내는 이름으로
```

- **판정 줄**: 전체에서 가장 높은 단계가 판정이다.
  - `🔴 위험 — 머지 금지`
  - `🟠 경고 — 머지 전 수정`
  - `🟡 주의 — 수정 권장`
  - `🟢 양호 — 발견 없음`
- **건수 줄**: 중복을 합친 뒤의 단계별 발견 수, 기준, 변경 파일 수. 세 단계를 `🔴 N · 🟠 N · 🟡 N` 순서로 항상 모두 적고 0건도 생략하지 않는다. `scripts/review_gate.py`가 이 줄로 PR의 머지 판정을 정한다. 기준이 `--staged`면 `기준 staged`로 적는다. 합친 것이 있으면 끝에 `(중복 N건 합침)`을 붙인다.
- **표**: 항상 10행이고 위의 순서를 지킨다. `위험` 칸은 그 차원의 리뷰어가 매긴 단계 중 가장 높은 것이고, `건수`는 그 리뷰어가 보고한 수다. 발견이 없으면 🟢, 변경에 그 차원이 볼 것이 없으면 ⚪ 해당 없음, 리뷰어가 실패하면 ⚫ 리뷰 실패. ⚪와 ⚫의 건수는 `-`로 적는다.
- **발견 사항**: 🔴 → 🟠 → 🟡 순서로 묶는다. 🔴와 🟠는 제목, `파일:줄`, 코드 인용, 이유, 수정을 블록으로 쓴다. 🟡는 한 줄로 쓴다. 발견이 없는 단계의 절은 쓰지 않는다.
- **리뷰 실패가 있을 때**: ⚫인 차원이 하나라도 있으면 판정을 `🟢 양호`로 쓰지 않고, 판정 줄 끝에 `(리뷰 실패 N개 차원)`을 붙인다.
- conventions 리뷰어가 "브라우저 확인 필요"를 적어 보냈으면 발견 사항 뒤에 그 한 줄을 옮겨 적는다.

## 차원을 전담으로 떼어낼 때

1. `.claude/agents/review-<차원>.md`를 `review-security.md`와 같은 틀로 추가한다.
2. 위 배정표에서 그 차원을 `review-general` 줄에서 빼 새 줄로 옮기고, "3. 실행"의 개수를 고친다.

`layers/`의 체크리스트와 `review-general.md`는 고치지 않는다.
