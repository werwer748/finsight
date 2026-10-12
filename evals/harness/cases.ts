import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCase } from "./lib.ts";
import type { EvalCase } from "./lib.ts";

const CASES_DIR = join(import.meta.dirname, "cases");

// 파일 이름(확장자 제외)이 케이스 이름이다.
export function loadCases(): EvalCase[] {
  return readdirSync(CASES_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => parseCase(name.slice(0, -".md".length), readFileSync(join(CASES_DIR, name), "utf8")));
}

// 사본을 두지 않고 저장소 루트의 CLAUDE.md를 실행할 때마다 읽는다.
export function readClaudeMd(): string {
  return readFileSync(join(import.meta.dirname, "../../CLAUDE.md"), "utf8");
}
