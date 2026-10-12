// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadCases, readClaudeMd } from "./cases.ts";
import { extractCriticalRules } from "./lib.ts";

// 키 없이 도는 검사. 형식이 틀린 케이스가 있으면 loadCases가 케이스 이름과 함께 던진다.
const cases = loadCases();
const review = cases.flatMap((evalCase) => (evalCase.track === "review" ? [evalCase] : []));
const qa = cases.flatMap((evalCase) => (evalCase.track === "qa" ? [evalCase] : []));

describe("golden set", () => {
  it("두 트랙 모두 케이스가 있다", () => {
    expect(review.length).toBeGreaterThan(0);
    expect(qa.length).toBeGreaterThan(0);
  });

  it("입력이 같은 케이스가 없다", () => {
    expect(new Set(cases.map((evalCase) => evalCase.input)).size).toBe(cases.length);
  });

  it("review 트랙에 위반 케이스와 오탐 방지용 정상 케이스가 모두 있다", () => {
    expect(review.some((evalCase) => evalCase.expect === "violation")).toBe(true);
    expect(review.some((evalCase) => evalCase.expect === "pass")).toBe(true);
  });

  it("qa 트랙에 틀린 전제 반박 가드가 있고, 가드는 받아들이면 안 되는 전제를 적어 둔다", () => {
    const guards = qa.filter((evalCase) => evalCase.kind === "false-premise");
    expect(guards.length).toBeGreaterThan(0);
    for (const guard of guards) {
      expect(guard.mustNot.length, guard.id).toBeGreaterThan(0);
    }
  });
});

describe("라이브 CLAUDE.md", () => {
  it("review 트랙이 시스템 프롬프트로 쓸 CRITICAL 규칙이 추출된다", () => {
    expect(extractCriticalRules(readClaudeMd()).length).toBeGreaterThan(0);
  });
});
