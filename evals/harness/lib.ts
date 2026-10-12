// 라벨 파서와 집계. 파일과 네트워크를 건드리지 않는 순수 함수만 둔다.

export type Track = "review" | "qa";

const QA_KINDS = ["convention", "exception", "gotcha", "false-premise"] as const;
export type QaKind = (typeof QA_KINDS)[number];

type CaseBase = { id: string; input: string };
export type ReviewCase = CaseBase & { track: "review" } & ({ expect: "violation"; rule: string } | { expect: "pass" });
export type QaCase = CaseBase & { track: "qa"; kind: QaKind; must: string[]; mustNot: string[] };
export type EvalCase = ReviewCase | QaCase;

export type Verdict = { index: number; met: boolean; reason: string };
export type CaseResult = { id: string; track: Track; status: "pass" | "fail" | "error"; detail: string };
export type Summary = {
  total: number;
  passed: number;
  byTrack: Record<Track, { total: number; passed: number }>;
  ok: boolean;
};

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
const LIST_ITEM = /^\s*-\s+(.+)$/;
const LABEL = /^([a-z_]+):\s*(.*)$/;
const LABELS: Record<Track, string[]> = {
  review: ["track", "expect", "rule"],
  qa: ["track", "kind", "must", "must_not"],
};

function fail(id: string, message: string): never {
  throw new Error(`${id}: ${message}`);
}

// `키: 값`과 `키:` 아래의 `- 항목` 목록만 읽는다. 값의 따옴표는 벗기지 않는다.
function parseFrontmatter(id: string, markdown: string): { labels: Map<string, string | string[]>; body: string } {
  const match = FRONTMATTER.exec(markdown);
  if (!match) fail(id, "frontmatter(--- 사이의 라벨)가 없습니다.");

  const labels = new Map<string, string | string[]>();
  let list: string[] | undefined;
  for (const line of match[1].split("\n")) {
    if (!line.trim()) continue;
    const item = LIST_ITEM.exec(line);
    if (item) {
      if (!list) fail(id, `목록 항목이 속할 라벨이 없습니다: ${line.trim()}`);
      list.push(item[1].trim());
      continue;
    }
    const label = LABEL.exec(line);
    if (!label) fail(id, `읽을 수 없는 frontmatter 줄입니다: ${line}`);
    const [, key, value] = label;
    if (labels.has(key)) fail(id, `라벨 ${key}가 두 번 나옵니다.`);
    list = value === "" ? [] : undefined;
    labels.set(key, list ?? value);
  }
  return { labels, body: match[2].trim() };
}

export function parseCase(id: string, markdown: string): EvalCase {
  const { labels, body } = parseFrontmatter(id, markdown);
  if (!body) fail(id, "본문(subject에 줄 입력)이 비어 있습니다.");

  const track = labels.get("track");
  if (track !== "review" && track !== "qa") fail(id, "track은 review 또는 qa여야 합니다.");
  const unknown = [...labels.keys()].find((key) => !LABELS[track].includes(key));
  if (unknown) fail(id, `${track} 트랙에 없는 라벨입니다: ${unknown}`);

  if (track === "review") {
    const expect = labels.get("expect");
    const rule = labels.get("rule");
    if (expect === "pass") {
      if (rule !== undefined) fail(id, "expect: pass 케이스에는 rule을 쓰지 않습니다.");
      return { id, track, expect, input: body };
    }
    if (expect !== "violation") fail(id, "expect는 violation 또는 pass여야 합니다.");
    if (typeof rule !== "string") fail(id, "expect: violation 케이스에는 잡아야 할 위반을 rule에 적습니다.");
    return { id, track, expect, rule, input: body };
  }

  const kind = QA_KINDS.find((candidate) => candidate === labels.get("kind"));
  if (!kind) fail(id, `kind는 ${QA_KINDS.join(", ")} 중 하나여야 합니다.`);
  const must = labels.get("must");
  if (!Array.isArray(must) || must.length === 0) fail(id, "must에는 응답에 있어야 할 사실을 하나 이상 목록으로 적습니다.");
  const mustNot = labels.get("must_not") ?? [];
  if (!Array.isArray(mustNot)) fail(id, "must_not은 목록으로 적습니다.");
  return { id, track, kind, must, mustNot, input: body };
}

export function extractCriticalRules(claudeMd: string): string[] {
  return [...claudeMd.matchAll(/^- CRITICAL: (.+)$/gm)].map((match) => match[1]);
}

// 채점 모델에 줄 기준. 기준 하나가 라벨 하나에 대응한다.
export function criteriaFor(evalCase: EvalCase): string[] {
  if (evalCase.track === "qa") {
    return [
      ...evalCase.must.map((fact) => `응답에 다음 내용이 있다: ${fact}`),
      ...evalCase.mustNot.map((claim) => `응답이 다음을 주장하거나 권하지 않는다: ${claim}`),
    ];
  }
  if (evalCase.expect === "violation") return [`리뷰가 다음 위반을 지적한다: ${evalCase.rule}`];
  // "보고하지 않는다"로 쓰면 엉뚱한 응답도 충족하므로 결론을 요구한다.
  return ["리뷰가 이 코드에 CRITICAL 규칙 위반이 없다고 결론 내린다"];
}

// 미충족 기준을 돌려준다. 비어 있으면 통과다. 통과 여부는 채점 모델의 총평이 아니라 기준별 판정을 코드로 모아 정한다.
export function grade(criteria: string[], verdicts: Verdict[]): string[] {
  return criteria.flatMap((criterion, index) => {
    const own = verdicts.filter((verdict) => verdict.index === index);
    if (own.length === 0) return [`${criterion} (판정 없음)`];
    return own.filter((verdict) => !verdict.met).map((verdict) => `${criterion} (${verdict.reason})`);
  });
}

export function summarize(results: CaseResult[]): Summary {
  const byTrack = { review: { total: 0, passed: 0 }, qa: { total: 0, passed: 0 } };
  for (const { track, status } of results) {
    byTrack[track].total += 1;
    if (status === "pass") byTrack[track].passed += 1;
  }
  const total = results.length;
  const passed = byTrack.review.passed + byTrack.qa.passed;
  // 채점한 케이스가 없으면 아무것도 확인하지 못한 것이므로 통과로 보지 않는다.
  return { total, passed, byTrack, ok: total > 0 && passed === total };
}
