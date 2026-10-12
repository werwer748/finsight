// @vitest-environment node
import { describe, expect, it } from "vitest";
import { criteriaFor, extractCriticalRules, grade, parseCase, summarize } from "./lib.ts";
import type { CaseResult } from "./lib.ts";

function markdown(labels: string[], body = "본문"): string {
  return ["---", ...labels, "---", "", body, ""].join("\n");
}

describe("parseCase", () => {
  it("review 위반 케이스의 라벨과 본문을 나눈다", () => {
    const parsed = parseCase(
      "review-a",
      markdown(["track: review", "expect: violation", "rule: 클라이언트에서 Supabase를 직접 호출한다"], "```tsx\n\"use client\";\n```"),
    );
    expect(parsed).toEqual({
      id: "review-a",
      track: "review",
      expect: "violation",
      rule: "클라이언트에서 Supabase를 직접 호출한다",
      input: "```tsx\n\"use client\";\n```",
    });
  });

  it("review 정상 케이스는 rule 없이 읽는다", () => {
    expect(parseCase("review-b", markdown(["track: review", "expect: pass"]))).toEqual({
      id: "review-b",
      track: "review",
      expect: "pass",
      input: "본문",
    });
  });

  it("qa 케이스의 must와 must_not 목록을 읽는다", () => {
    const parsed = parseCase(
      "qa-a",
      markdown([
        "track: qa",
        "kind: gotcha",
        "must:",
        "  - Bash 제한 시간을 10분으로 준다",
        "  - 훅이 리뷰를 돌린다: 길면 9분",
        "must_not:",
        "  - `--no-verify`로 우회하라고 권한다",
      ], "커밋이 끊겨요."),
    );
    expect(parsed).toEqual({
      id: "qa-a",
      track: "qa",
      kind: "gotcha",
      must: ["Bash 제한 시간을 10분으로 준다", "훅이 리뷰를 돌린다: 길면 9분"],
      mustNot: ["`--no-verify`로 우회하라고 권한다"],
      input: "커밋이 끊겨요.",
    });
  });

  it("must_not을 생략하면 빈 목록이다", () => {
    const parsed = parseCase("qa-b", markdown(["track: qa", "kind: convention", "must:", "  - 사실"]));
    expect(parsed).toMatchObject({ mustNot: [] });
  });

  it("본문에 든 --- 줄은 본문으로 남긴다", () => {
    const parsed = parseCase("review-c", markdown(["track: review", "expect: pass"], "위\n---\nexpect: violation\n---\n아래"));
    expect(parsed.input).toBe("위\n---\nexpect: violation\n---\n아래");
  });

  it.each([
    ["frontmatter가 없다", "본문만 있다\n", "frontmatter"],
    ["track을 모른다", markdown(["track: lint"]), "track"],
    ["모르는 라벨이 있다", markdown(["track: qa", "kind: gotcha", "must:", "  - 사실", "mustnot:", "  - 오타"]), "mustnot"],
    ["같은 라벨이 두 번 나온다", markdown(["track: review", "expect: pass", "expect: violation"]), "expect"],
    ["목록 항목이 라벨 없이 나온다", markdown(["  - 떠도는 항목", "track: review", "expect: pass"]), "떠도는 항목"],
    ["expect 값이 틀리다", markdown(["track: review", "expect: fail"]), "expect"],
    ["위반 케이스에 rule이 없다", markdown(["track: review", "expect: violation"]), "rule"],
    ["정상 케이스에 rule이 있다", markdown(["track: review", "expect: pass", "rule: 없어야 한다"]), "rule"],
    ["kind 값이 틀리다", markdown(["track: qa", "kind: trivia", "must:", "  - 사실"]), "kind"],
    ["must가 비어 있다", markdown(["track: qa", "kind: gotcha", "must:"]), "must"],
    ["must가 목록이 아니다", markdown(["track: qa", "kind: gotcha", "must: 사실"]), "must"],
    ["본문이 비어 있다", markdown(["track: review", "expect: pass"], ""), "본문"],
  ])("%s → 케이스 이름과 함께 거부한다", (_name, source, keyword) => {
    expect(() => parseCase("bad-case", source)).toThrow(/bad-case/);
    expect(() => parseCase("bad-case", source)).toThrow(keyword);
  });
});

describe("extractCriticalRules", () => {
  it("CRITICAL 줄만 문서 순서대로 뽑는다", () => {
    const claudeMd = [
      "## 아키텍처 규칙",
      "- CRITICAL: 금액은 코드로 계산할 것.",
      "- 페이지는 얇게 둔다.",
      "## 개발 프로세스",
      "- CRITICAL: 테스트를 먼저 작성할 것 (TDD)",
      "🔴는 CRITICAL 규칙 위반이다.",
    ].join("\n");
    expect(extractCriticalRules(claudeMd)).toEqual(["금액은 코드로 계산할 것.", "테스트를 먼저 작성할 것 (TDD)"]);
  });

  it("CRITICAL 줄이 없으면 빈 배열이다", () => {
    expect(extractCriticalRules("# 제목\n- 규칙")).toEqual([]);
  });
});

describe("criteriaFor", () => {
  it("위반 케이스는 그 위반을 지적했는지를 묻는다", () => {
    const criteria = criteriaFor({ id: "r", track: "review", expect: "violation", rule: "RLS를 켜지 않았다", input: "sql" });
    expect(criteria).toHaveLength(1);
    expect(criteria[0]).toContain("RLS를 켜지 않았다");
  });

  it("정상 케이스는 위반이 없다고 결론 냈는지를 묻는다", () => {
    const criteria = criteriaFor({ id: "r", track: "review", expect: "pass", input: "ts" });
    expect(criteria).toHaveLength(1);
    expect(criteria[0]).toContain("위반이 없다");
  });

  it("qa 케이스는 must와 must_not을 기준 하나씩으로 편다", () => {
    const criteria = criteriaFor({
      id: "q",
      track: "qa",
      kind: "false-premise",
      must: ["npm을 쓴다고 바로잡는다", "설치 명령은 npm install이다"],
      mustNot: ["pnpm add로 설치하라고 안내한다"],
      input: "질문",
    });
    expect(criteria).toHaveLength(3);
    expect(criteria[0]).toContain("npm을 쓴다고 바로잡는다");
    expect(criteria[1]).toContain("설치 명령은 npm install이다");
    expect(criteria[2]).toContain("pnpm add로 설치하라고 안내한다");
    expect(criteria[2]).toContain("않는다");
  });
});

describe("grade", () => {
  const criteria = ["기준 0", "기준 1"];

  it("모든 기준이 충족이면 미충족 목록이 비어 있다", () => {
    expect(grade(criteria, [
      { index: 0, met: true, reason: "있음" },
      { index: 1, met: true, reason: "있음" },
    ])).toEqual([]);
  });

  it("미충족 기준을 채점 근거와 함께 돌려준다", () => {
    const unmet = grade(criteria, [
      { index: 0, met: true, reason: "있음" },
      { index: 1, met: false, reason: "언급이 없다" },
    ]);
    expect(unmet).toHaveLength(1);
    expect(unmet[0]).toContain("기준 1");
    expect(unmet[0]).toContain("언급이 없다");
  });

  it("판정이 빠진 기준은 미충족이다", () => {
    const unmet = grade(criteria, [{ index: 0, met: true, reason: "있음" }]);
    expect(unmet).toHaveLength(1);
    expect(unmet[0]).toContain("기준 1");
  });

  it("같은 기준에 판정이 엇갈리면 미충족이다", () => {
    const unmet = grade(criteria, [
      { index: 0, met: true, reason: "있음" },
      { index: 1, met: true, reason: "있음" },
      { index: 1, met: false, reason: "다시 보니 없다" },
    ]);
    expect(unmet).toHaveLength(1);
    expect(unmet[0]).toContain("다시 보니 없다");
  });

  it("기준에 없는 번호의 판정은 무시한다", () => {
    expect(grade(["기준 0"], [
      { index: 0, met: true, reason: "있음" },
      { index: 7, met: false, reason: "없는 기준" },
    ])).toEqual([]);
  });
});

describe("summarize", () => {
  function result(id: string, track: CaseResult["track"], status: CaseResult["status"]): CaseResult {
    return { id, track, status, detail: "" };
  }

  it("트랙별 통과 수와 합계를 센다", () => {
    expect(summarize([
      result("r1", "review", "pass"),
      result("r2", "review", "pass"),
      result("q1", "qa", "pass"),
    ])).toEqual({
      total: 3,
      passed: 3,
      byTrack: { review: { total: 2, passed: 2 }, qa: { total: 1, passed: 1 } },
      ok: true,
    });
  });

  it("하나라도 실패하면 ok가 아니다", () => {
    const summary = summarize([result("r1", "review", "pass"), result("q1", "qa", "fail")]);
    expect(summary.ok).toBe(false);
    expect(summary.byTrack.qa).toEqual({ total: 1, passed: 0 });
  });

  it("호출 오류는 통과로 세지 않는다", () => {
    const summary = summarize([result("r1", "review", "pass"), result("r2", "review", "error")]);
    expect(summary.passed).toBe(1);
    expect(summary.ok).toBe(false);
  });

  it("채점한 케이스가 없으면 ok가 아니다", () => {
    expect(summarize([]).ok).toBe(false);
  });
});
