# 하네스 eval

CLAUDE.md를 비롯한 하네스가 약해졌는지 잡는 회귀 게이트다. golden set(`cases/*.md`)의 입력을 subject 모델에 주고, 다른 모델이 그 응답을 라벨에 비춰 pass/fail로 채점한다. 하나라도 통과하지 못하면 `run.ts`가 exit 1로 끝난다.

## 실행

```bash
npm test        # 키 없이 돈다. 파서·집계 단위 테스트와 golden set 무결성·균형 검사
npm run eval    # 라이브 채점. 호출마다 비용이 든다
```

`npm run eval`은 `ANTHROPIC_API_KEY`가 필요하다. `.env.local`이 있으면 거기서 읽는다. 케이스마다 subject 1회, judge 1회를 호출한다.

| 표시 | 뜻 |
|---|---|
| ✅ | 모든 기준 충족 |
| ❌ | 미충족 기준이 있다. 기준, 채점 근거, subject 응답을 함께 출력한다 |
| ⚠️ | 호출이 실패했거나 응답이 잘렸다. 오답과 구분해 보고하지만 게이트는 똑같이 막는다 |

## 트랙

| | review | qa |
|---|---|---|
| 보는 것 | 경량 리뷰어가 코드의 CRITICAL 규칙 위반을 잡는가 | 응답자가 저장소 질문(규약, 예외, gotcha)에 맞게 답하는가 |
| subject 입력 | 케이스 본문의 코드 | 케이스 본문의 질문 |
| 시스템 프롬프트 | 실행할 때 CLAUDE.md에서 뽑은 `- CRITICAL:` 줄 | 실행할 때 읽은 CLAUDE.md 전문 |
| 라벨 | `expect`, `rule` | `kind`, `must`, `must_not` |
| 통과 조건 | `violation`: `rule`의 위반을 지적한다<br>`pass`: 위반이 없다고 결론 낸다 | `must`가 전부 응답에 있고 `must_not`은 하나도 없다 |

CLAUDE.md는 사본을 두지 않고 매번 읽는다. 규칙을 지우거나 약하게 고치면 해당 케이스가 실패한다.

- subject: `claude-sonnet-5-5`. 이 모델은 `temperature`를 받지 않아 `effort: low`로 변동을 줄인다.
- judge: `claude-opus-5-5`. 기준마다 충족 여부를 돌려주고, 통과 여부는 코드가 모아서 정한다.

## 케이스 형식

파일 이름이 케이스 이름이다. frontmatter가 라벨이고 본문이 subject에 가는 입력이다. 라벨은 subject에 보내지 않는다.

````markdown
---
track: review
expect: violation
rule: 사용자 데이터를 담는 테이블에 RLS를 켜지 않았다
---

파일: `supabase/migrations/20261012000000_budgets.sql`

```sql
create table public.budgets (…);
```
````

```markdown
---
track: qa
kind: false-premise
must:
  - 이 프로젝트의 패키지 매니저는 pnpm이 아니라 npm이라고 바로잡는다
must_not:
  - `pnpm add`로 설치하라고 안내한다
---

이 프로젝트는 pnpm을 쓰니까, 차트 라이브러리는 `pnpm add recharts`로 설치하면 되죠?
```

- `expect`: `violation` 또는 `pass`. `violation`이면 잡아야 할 위반을 `rule`에 적는다. `pass`에는 `rule`을 쓰지 않는다.
- `kind`: `convention`, `exception`, `gotcha`, `false-premise` 중 하나.
- `must`는 하나 이상, `must_not`은 생략할 수 있다. `false-premise` 케이스는 받아들이면 안 되는 전제를 `must_not`에 적는다.
- frontmatter는 `키: 값`과 `키:` 아래 `- 항목` 목록만 읽는다. 값에 따옴표를 두르지 않는다.

## 원칙

**golden set은 작게 시작한다.** 지금은 10건이다(review 위반 4건과 오탐 방지용 정상 1건, qa 5건 중 틀린 전제 반박 가드 1건). 사람이 전부 읽고 라벨이 맞다고 확신할 수 있는 크기를 유지한다. 리뷰가 위반을 놓쳤거나 에이전트가 틀리게 답한 일이 실제로 생기면 그 사례를 한 건씩 더한다. 한 케이스는 한 가지만 본다.

**라벨은 사람이 박제한다.** `expect`, `rule`, `must`, `must_not`은 사람이 CLAUDE.md를 읽고 정해서 커밋한다. 모델의 출력으로 라벨을 만들지 않고, eval이 실패했다고 라벨을 모델의 답에 맞춰 고치지 않는다. 실패하면 CLAUDE.md와 subject 응답을 먼저 본다. 라벨은 규칙이 바뀌었을 때만 사람이 고친다.

케이스 파일만 바꾼 커밋은 문서 변경으로 취급되어 pre-commit 리뷰를 건너뛴다. 라벨 변경은 PR에서 사람이 직접 확인한다.

**균형은 테스트가 지킨다.** review 트랙에 위반과 정상이 모두 있어야 전부 위반이라고 답하는 리뷰어가 통과하지 못한다. qa 트랙에는 틀린 전제 반박 가드가 있어야 질문에 맞장구치는 응답자가 통과하지 못한다. `cases.test.ts`가 이 조건과 케이스 형식을 검사한다.

## 파일

| 파일 | 역할 |
|---|---|
| `cases/*.md` | golden set |
| `lib.ts` | 순수 함수. 라벨 파서, 채점 기준, 판정 집계 |
| `cases.ts` | `cases/`와 CLAUDE.md를 읽는다 |
| `run.ts` | 라이브 채점. subject와 judge를 호출한다 |

`npm run eval`은 node가 TypeScript를 직접 실행하므로 이 폴더의 상대 import에는 `.ts` 확장자를 붙인다.
