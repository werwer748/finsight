---
name: owasp-audit
description: FinSight 저장소 전체의 현재 상태를 OWASP Top 10:2025(A01~A10)에 맞춰 감사하고 위험 단계별로 보고한다. 코드는 고치지 않는다. 사용자가 `/owasp-audit`을 실행하거나 보안 감사·보안 점검·취약점 점검·OWASP 점검을 요청할 때 사용한다. 변경분만 보는 `/review-code`와는 다른 스킬이다.
allowed-tools:
  - Bash(npm audit --json)
  - Bash(npm audit --omit=dev --json)
  - Bash(npm audit signatures)
  - Bash(gh api repos/werwer748/finsight)
  - Bash(gh api repos/werwer748/finsight/branches/main/protection)
  - Bash(gh api repos/werwer748/finsight/rules/branches/main)
  - Bash(gh api repos/werwer748/finsight/vulnerability-alerts)
  - Bash(gh api repos/werwer748/finsight/actions/permissions)
  - Bash(gh api repos/werwer748/finsight/actions/permissions/workflow)
  - Bash(gh api -X GET repos/werwer748/finsight/secret-scanning/alerts -f state=open -f hide_secret=true)
---

저장소 전체의 현재 상태를 OWASP Top 10:2025의 10개 항목으로 감사한다. 변경분이 아니라 지금 있는 코드, 설정, 의존성, GitHub 저장소 설정을 본다. 코드는 고치지 않고 보고만 한다.

## 규칙

- 코드와 설정을 고치지 않는다. 이 스킬이 쓰는 파일은 "6. 저장"의 보고서 하나뿐이다.
- 서브에이전트를 띄우지 않는다. 한 세션이 A01부터 A10까지 차례로 본다.
- `.env.local`을 읽지 않는다. 시크릿을 찾으면 값은 적지 않고 종류와 위치(`파일:줄` 또는 커밋)만 적는다.
- 검색은 `src`, `supabase`, `.github`, `scripts`, 루트의 설정 파일처럼 대상을 지정해서 한다. 저장소 루트에서 재귀로 찾으면 `.claude/worktrees/` 안의 `src/` 사본이 함께 잡힌다.
- 파일은 `find`로 찾는다. zsh는 맞는 파일이 없는 글롭을 오류로 처리한다.
- `scripts/bash_guard.py`가 막는 문자열이 든 Bash 명령은 쓰지 않는다. SQL 파일은 Read로 읽는다.
- "3. 수집"의 `npm`과 `gh` 명령은 적힌 그대로 실행하고, Bash 호출 하나에 명령 하나만 넣는다. frontmatter의 `allowed-tools`가 그 문자열만 허용하므로 옵션이나 파이프를 붙이면 권한 확인이 뜬다.
- `npm audit fix`, `gh auth login`, `gh auth refresh`는 실행하지 않는다. `gh`가 안내 문구로 권해도 마찬가지다.
- Stop 훅이 lint·build·test 실패를 알려도 고치지 않는다. 보고 끝에 한 줄로 적는다.

## 1. 준비

1. `docs/ADR.md`를 읽는다. 체크가 ADR 번호로 가리키는 숫자와 세부는 여기서 확인한다.
2. `.claude/skills/review-code/reviewer-rules.md`의 "발견 사항" 절에서 위험 단계 표를 읽는다. 단계의 뜻은 그 표와 같다.
3. 아래를 실행한다.

```bash
git rev-parse --short HEAD
git status --short
git remote get-url origin
```

`origin` 주소에 `werwer748/finsight`가 없으면 "3. 수집"의 `gh api` 명령을 실행하지 않고, 그 결과를 쓰는 체크를 모두 ⚫ 확인 실패로 적는다. 이 스킬의 `gh api` 명령은 그 저장소로 고정돼 있어서, 다른 저장소에서 돌리면 남의 설정을 감사하게 된다.

커밋하지 않은 변경이 있으면 보고의 건수 줄 끝에 `(커밋하지 않은 변경 포함)`을 붙인다.

## 2. 대상 파악

체크의 대상이 저장소에 있는지 먼저 찾는다. 대상이 없는 체크는 ⚪ 해당 없음이고, 그 판단은 전부 이 절의 결과로 한다. 폴더가 없다는 오류는 대상이 없다는 뜻이다. `*.test.*` 파일은 대상으로 세지 않는다.

```bash
# I1 진입점: 라우트 핸들러, 페이지, proxy
find src/app -name 'route.ts' -o -name 'page.tsx'
ls src/proxy.ts
# I2 서버 액션
grep -rlE "[\"']use server[\"']" src
# I3 클라이언트 컴포넌트
grep -rlE "^[\"']use client[\"']" src
# I4 DB: SQL 파일과 쿼리 호출
find supabase -name '*.sql'
grep -rlE "\.from\(|\.rpc\(" src
# I5 외부 서비스 래퍼
ls src/services
grep -nE '"@anthropic-ai/sdk"|"@polar-sh|"xlsx"' package.json
# I6 업로드와 파싱
grep -rlE "formData\(\)|from [\"']xlsx[\"']" src
# I7 결제와 플랜
grep -rliE "polar|webhook" src supabase
grep -rlwE "plan|plans|subscription|subscriptions|isPro" src supabase
# I8 환경변수 이름
grep -rhoE "process\.env\.[A-Z0-9_]+" src next.config.ts
```

I8은 `.env.example`도 읽어 이름을 더한다.

## 3. 수집

아래 명령으로 결과를 모은다. 서로 기다릴 필요가 없으니 여러 개를 동시에 실행해도 된다.

### 로컬

- **L1** `npm audit --json` — 전체 의존성의 알려진 취약점.
- **L2** `npm audit --omit=dev --json` — 운영 의존성만.
- **L3** `npm audit signatures` — 설치된 패키지의 레지스트리 서명.
- **L4** lockfile의 출처. 앞의 두 수는 같아야 하고, 셋째는 npm 레지스트리 밖에서 받는 항목을 보여 준다.

  ```bash
  grep -c '"resolved":' package-lock.json
  grep -c '"integrity":' package-lock.json
  grep -n '"resolved":' package-lock.json | grep -v 'https://registry.npmjs.org/'
  ```

- **L5** 이력에 들어간 env 파일. 하위 폴더의 것도 잡는다.

  ```bash
  git log --all --oneline --name-only -- ':(glob)**/.env*' ':(exclude,glob)**/.env.example'
  ```

- **L6** 이력의 시크릿 모양 문자열. 커밋과 파일 이름만 나오고 값은 나오지 않는다.

  ```bash
  git log --all --oneline --name-only -G'sk-ant-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{16,}|eyJhbGciOi[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}|BEGIN [A-Z ]*PRIVATE KEY|whsec_[A-Za-z0-9+/=]{20,}|polar_[a-z]+_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}' -- . ':!package-lock.json'
  ```

- **L7** 무시 규칙. 무시되는 경로만 줄이 나온다.

  ```bash
  git check-ignore -v .env.local .security-audit/x.md
  ```

- **L8** 클라이언트 번들. `.next/BUILD_ID`가 없으면 건너뛴다. 있으면 그 파일의 시각이 빌드 시각이다.

  ```bash
  ls -l .next/BUILD_ID
  grep -rlE "ANTHROPIC_API_KEY|sk-ant-|sb_secret_|service_role|createBrowserClient|GoTrueClient" .next/static
  ```

### GitHub

- **G1** `gh api repos/werwer748/finsight` — `visibility`, `security_and_analysis`, `permissions.admin`, `default_branch`, `allow_auto_merge`.
- **G2** `gh api repos/werwer748/finsight/branches/main/protection` — `main` 브랜치 보호.
- **G3** `gh api repos/werwer748/finsight/rules/branches/main` — `main`에 걸린 ruleset.
- **G4** `gh api repos/werwer748/finsight/vulnerability-alerts` — Dependabot 알림. 켜져 있으면 출력 없이 성공한다.
- **G5** `gh api repos/werwer748/finsight/actions/permissions`, `gh api repos/werwer748/finsight/actions/permissions/workflow` — Actions 권한.
- **G6** `gh api -X GET repos/werwer748/finsight/secret-scanning/alerts -f state=open -f hide_secret=true` — 열려 있는 secret scanning 알림. 값은 가려서 받는다.

G1의 `default_branch`가 `main`이 아니면 G2와 G3의 결과를 쓰는 체크를 ⚫로 적는다.

### 결과 읽는 법

- `npm audit`는 취약점이 있으면 종료 코드 1로 끝난다. 출력에 `metadata.vulnerabilities`가 있으면 실패가 아니라 결과다. 그 값이 없으면(오프라인 등) ⚫다.
- L3은 서명이 틀리거나 없는 패키지를 찾아도 종료 코드 1로 끝난다. 그런 패키지가 나열돼 있으면 실패가 아니라 결과다. 그 밖의 오류로 끝나거나 `node_modules`가 없으면 ⚫다.
- L5나 L6에 줄이 나오면 🔴 후보다. 커밋과 경로를 적고 값은 적지 않는다. 테스트 픽스처나 가림 패턴처럼 진짜 시크릿이 아닌 것은 확인한 뒤 뺀다.
- GitHub의 403과 404는 상태 코드가 아니라 응답의 `message`로 가른다. 아래는 확인 실패가 아니라 발견이다.
  - G2가 `Branch not protected`이고 G3이 빈 배열이다.
  - G4가 `Vulnerability alerts are disabled.`다.
  - G6이 `Secret scanning is disabled on this repository.`다. G1에서 이미 적은 발견이므로 다시 세지 않는다.
- 그 밖의 403·404, 인증 실패, 연결 실패는 ⚫이고 `message`를 이유로 적는다.
- G1의 `permissions.admin`이 false면 G2, G4, G5, G6의 403·404를 모두 ⚫로 적는다. 꺼진 것과 권한이 없는 것을 구별할 수 없다.
- G1의 응답에 `security_and_analysis`가 없으면 A02-2는 ⚫다. 관리자 권한이 없으면 그 필드가 빠진다.
- `npm audit`가 보지 못하는 것이 있다. npm 레지스트리 밖에서 받는 SheetJS tarball(ADR-013), GitHub 액션, CI가 전역으로 설치하는 도구다. A03-3, A03-5와 A03의 수동 확인이 맡는다.

## 4. 점검

A01부터 A10까지 차례로 `categories/A0N.md`를 읽고 그 파일의 체크를 순서대로 본다. 파일은 그 항목을 볼 차례에 읽는다. 열 개를 먼저 다 읽지 않는다.

체크마다 결과를 하나 적는다.

- 발견: 위치, 코드 인용, 이유, 수정, 단계를 적는다.
- 🟢 통과: 대상을 봤고 문제가 없다.
- ⚪ 해당 없음: "2. 대상 파악"에서 대상을 찾지 못했다. 이유를 한 줄 적는다.
- ⚫ 확인 실패: 명령이 실패했거나 권한이 없어 볼 수 없었다. 이유를 한 줄 적는다.

판정 규칙은 아래와 같다.

- 근거(`파일:줄`이나 명령 출력)를 댈 수 없으면 발견으로 적지 않는다.
- 체크 제목에 단계가 적혀 있으면 그 단계를 쓴다. "표"라고 적힌 체크는 `reviewer-rules.md`의 표로 정한다. 두 단계 사이에서 망설여지면 낮은 쪽을 고르고 불확실한 점을 이유에 적는다. `CLAUDE.md`의 CRITICAL 규칙 위반은 항상 🔴다.
- 한 문제는 한 번만 보고한다. 같은 줄이 두 체크에 걸리면 번호가 앞선 체크에 적고 다른 체크 번호를 덧붙인다.
- 카테고리 파일의 "보고하지 않는다"에 있는 것은 발견으로 적지 않는다.
- "수동 확인" 항목은 확인하려 하지 않는다. 보고에 그대로 옮긴다.

## 5. 보고

아래 틀을 그대로 쓴다. 숫자와 내용은 예시다.

```
## 감사 결과: 🔴 위험 — 지금 수정 (확인 실패 1건)
🔴 1 · 🟠 1 · 🟡 2    OWASP Top 10:2025 · 커밋 a1b2c3d · 2026-11-02

| #   | 항목                                   | 위험 | 건수 | 점검 | 수동 |
|-----|----------------------------------------|------|------|------|------|
| A01 | Broken Access Control                  | 🔴   | 1    | 6/7  | 4    |
| A02 | Security Misconfiguration              | 🟢   | 0    | 3/3  | 4    |
| A03 | Software Supply Chain Failures         | 🟠   | 1    | 5/5  | 3    |
| A04 | Cryptographic Failures                 | 🟢   | 0    | 6/6  | 3    |
| A05 | Injection                              | 🟡   | 1    | 4/4  | 0    |
| A06 | Insecure Design                        | 🟡   | 1    | 4/4  | 2    |
| A07 | Authentication Failures                | 🟢   | 0    | 4/4  | 5    |
| A08 | Software or Data Integrity Failures    | ⚫   | -    | 2/4  | 2    |
| A09 | Security Logging and Alerting Failures | 🟢   | 0    | 3/3  | 3    |
| A10 | Mishandling of Exceptional Conditions  | 🟢   | 0    | 4/4  | 1    |

### 🔴 위험 (1)
**[A01-2] `uploads` 테이블에 RLS가 꺼져 있음**
`supabase/migrations/20261101000000_uploads.sql:4`
> create table public.uploads (
이유: 사용자 데이터를 담는 테이블은 전부 RLS로 격리한다 (CRITICAL, ADR-002)
수정: RLS를 켜고 `user_id`로 격리하는 정책을 더한다

### 🟠 경고 (1)
**[A03-3] SheetJS를 npm 레지스트리에서 설치함**
`package.json:14`
> "xlsx": "^0.18.5"
이유: ADR-013은 공식 CDN tarball을 버전 고정으로 설치하기로 했다
수정: ADR-013의 URL로 바꾼다

### 🟡 주의 (2)
- [A05-1, A10-2] `src/app/api/upload/route.ts:21` — 쿼리 값을 타입 단언으로 좁힘 — 허용 목록으로 확인
- [A06-4] `src/lib/upload/validate.ts:1` — 상한 초과 케이스의 테스트 없음 — 실패 케이스 테스트 추가

### ⚪ 해당 없음 (2)
- A01-5 무료·Pro 권한의 서버 판정 — 결제·플랜 코드 없음
- A08-3 웹훅 서명 검증 — 웹훅 핸들러 없음

### ⚫ 확인 실패 (1)
- A08-1 `main` 보호 — G2가 403 `Resource not accessible by integration`

### 수동 확인
- [ ] [A01] Supabase → Authentication → URL Configuration — Site URL과 Redirect URLs
- [ ] [A02] 배포 사이트 — 응답 헤더
```

- **판정 줄**: 전체에서 가장 높은 단계가 판정이다.
  - `🔴 위험 — 지금 수정`
  - `🟠 경고 — 다음 배포 전 수정`
  - `🟡 주의 — 수정 권장`
  - `🟢 양호 — 발견 없음`
  - `⚫ 확인 실패 — 보지 못한 체크가 있음`
- **건수 줄**: 단계별 발견 수, 기준, 커밋, 날짜. 세 단계를 `🔴 N · 🟠 N · 🟡 N` 순서로 항상 모두 적고 0건도 생략하지 않는다.
- **표**: 항상 10행이고 위의 순서를 지킨다.
  - `위험`은 그 항목의 발견 중 가장 높은 단계다. 발견이 없으면 🟢, 체크가 전부 ⚪면 ⚪, 발견이 없는데 ⚫인 체크가 하나라도 있으면 ⚫다. ⚪와 ⚫의 건수는 `-`로 적는다.
  - `점검`은 그 항목에서 실제로 본 체크 수와 전체 체크 수다. ⚪와 ⚫는 본 것으로 세지 않는다.
  - `수동`은 그 항목의 수동 확인 수다.
- **발견 사항**: 🔴 → 🟠 → 🟡 순서로 묶는다. 🔴와 🟠는 제목, 위치, 인용, 이유, 수정을 블록으로 쓴다. 🟡는 한 줄로 쓴다. 발견이 없는 단계의 절은 쓰지 않는다. 제목 앞에 체크 번호를 붙인다.
- **파일이 아닌 근거**: 위치를 `GitHub 설정: <엔드포인트> → <필드>`나 `npm audit → <패키지> (<GHSA>)`로 적는다.
- **⚪와 ⚫**: 해당하는 체크를 전부 번호, 이름, 이유로 한 줄씩 적는다. 없으면 절을 쓰지 않는다.
- **확인 실패가 있을 때**: ⚫인 체크가 하나라도 있으면 판정 줄 끝에 `(확인 실패 N건)`을 붙인다. 발견이 하나도 없으면 판정을 `🟢 양호`가 아니라 `⚫ 확인 실패`로 쓴다.
- **수동 확인**: 카테고리 파일의 수동 확인을 항목 순서대로 전부 옮긴다. 판정에는 넣지 않는다.

## 6. 저장

L7의 출력에 `.security-audit/x.md` 줄이 있을 때만 "5. 보고"의 내용을 `.security-audit/<오늘 날짜 YYYY-MM-DD>.md`에 그대로 쓴다. 같은 날 파일이 있으면 덮어쓴다.

그 줄이 없으면 파일을 쓰지 않고 보고 끝에 그 사실을 적는다. 저장소가 공개라서 보고서가 커밋되면 고치지 않은 취약점 목록이 공개된다.

## 고칠 때

- ADR이 바뀌면 `grep -rn 'ADR-0' .claude/skills/owasp-audit`으로 그 번호를 가리키는 체크를 찾아 고친다.
- ADR이 OWASP의 권고를 받아들이지 않기로 정하면 해당 카테고리 파일의 "보고하지 않는다"에 한 줄 더한다.
- `next`나 `@supabase/ssr`를 올리면 A02와 A07이 가리키는 기본값과 문서 경로를 다시 확인한다.
- `gh api` 명령을 바꾸면 frontmatter의 `allowed-tools`도 같은 문자열로 고친다.
- 체크를 더하거나 빼면 그 파일만 고친다. 표의 `점검`과 `수동`은 실행할 때 센다.

## 출처

체크 항목의 분류와 각 카테고리 파일의 "OWASP 요약"은 [OWASP Top 10:2025](https://top10.owasp.org/2025/)를 한국어로 요약한 것이다. 원문은 OWASP Top 10 Team의 저작물이고 [CC BY 3.0](http://creativecommons.org/licenses/by/3.0/deed.en_US)으로 배포된다. 스냅샷 날짜는 2026-10-08이다. OWASP가 목록을 고치면 카테고리 파일의 요약과 체크를 함께 고친다.
