// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EMPTY_FILE_MESSAGE, UNSUPPORTED_FORMAT_MESSAGE } from "@/lib/parser/file-rules";
import { MAX_UPLOAD_BYTES, MAX_TRANSACTIONS_PER_UPLOAD, MAX_UPLOADS_PER_DAY, maxAllowedDate, validateUploadFile } from "./validate";

describe("validateUploadFile", () => {
  it("지원하지 않는 확장자는 공용 문구를 반환한다", () => {
    expect(validateUploadFile({ name: "test.pdf", size: 1 })).toBe(UNSUPPORTED_FORMAT_MESSAGE);
  });
  it("빈 파일은 공용 문구를 반환한다", () => {
    expect(validateUploadFile({ name: "test.csv", size: 0 })).toBe(EMPTY_FILE_MESSAGE);
  });
  it("4MB 초과 파일을 거절한다", () => {
    expect(validateUploadFile({ name: "test.csv", size: MAX_UPLOAD_BYTES + 1 })).toBe("파일이 너무 커요. 4MB 이하 파일을 올려 주세요.");
  });
  it.each(["test.csv", "test.CSV", "test.xlsx", "test.xls"])("%s는 정확히 4MB까지 통과한다", (name) => {
    expect(validateUploadFile({ name, size: 1 })).toBeNull();
    expect(validateUploadFile({ name, size: MAX_UPLOAD_BYTES })).toBeNull();
  });
  it("거래와 요청 제한값을 정의한다", () => {
    expect(MAX_UPLOAD_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_TRANSACTIONS_PER_UPLOAD).toBe(5000);
    expect(MAX_UPLOADS_PER_DAY).toBe(20);
  });
});

describe("maxAllowedDate", () => {
  it.each([
    ["2026-10-07T15:30:00Z", "2026-10-08"],
    ["2026-10-31T00:00:00Z", "2026-11-01"],
    ["2026-12-31T23:59:59Z", "2027-01-01"],
  ])("%s의 UTC 다음 날은 %s다", (now, expected) => {
    const date = new Date(now);
    expect(maxAllowedDate(date)).toBe(expected);
    expect(date.toISOString()).toBe(new Date(now).toISOString());
  });
});
