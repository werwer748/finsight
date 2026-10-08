// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EMPTY_FILE_MESSAGE, SUPPORTED_EXTENSIONS, UNSUPPORTED_FORMAT_MESSAGE, hasSupportedExtension } from "./file-rules";

describe("파일 형식 규칙", () => {
  it("확장자와 안내 문구의 원본을 정의한다", () => {
    expect(SUPPORTED_EXTENSIONS).toEqual([".csv", ".xlsx", ".xls"]);
    expect(UNSUPPORTED_FORMAT_MESSAGE).toBe("지원하지 않는 파일 형식이에요. CSV 또는 Excel(.xlsx, .xls) 파일을 올려 주세요.");
    expect(EMPTY_FILE_MESSAGE).toBe("파일에 내용이 없어요.");
  });
  it.each(["a.csv", "a.xlsx", "a.xls", "내역.CSV", "A.Xlsx"])("%s를 받는다", (name) => expect(hasSupportedExtension(name)).toBe(true));
  it.each(["a.pdf", "a.xlsx.pdf", "xlsx", ""])("%s를 거부한다", (name) => expect(hasSupportedExtension(name)).toBe(false));
});
