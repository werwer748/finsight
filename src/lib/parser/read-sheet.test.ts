// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { EMPTY_FILE_MESSAGE, UNSUPPORTED_FORMAT_MESSAGE } from "./file-rules";
import { MAX_CELLS, MAX_INFLATED_BYTES, MAX_SHEETS, ParseError, assertZipWithinLimit, readSheet } from "./read-sheet";

vi.mock("xlsx", { spy: true });

const DAMAGED = "파일을 읽지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.";
const TOO_LARGE = "파일 내용이 너무 커요. 기간을 나눠서 올려 주세요.";
const EUC_KR_CSV = new Uint8Array([
  0xb0, 0xc5, 0xb7, 0xa1, 0xc0, 0xcf, 0xc0, 0xda, 0x2c, 0xb0, 0xa1, 0xb8,
  0xcd, 0xc1, 0xa1, 0xb8, 0xed, 0x2c, 0xc0, 0xcc, 0xbf, 0xeb, 0xb1, 0xdd,
  0xbe, 0xd7, 0x0a, 0x32, 0x30, 0x32, 0x36, 0x2d, 0x30, 0x39, 0x2d, 0x30,
  0x31, 0x2c, 0xbd, 0xba, 0xc5, 0xb8, 0xb9, 0xf7, 0xbd, 0xba, 0x2c, 0x34,
  0x35, 0x30, 0x30, 0x0a,
]);
const GRID = [["거래일자", "가맹점명", "이용금액"], ["2026-09-01", "스타벅스", "4500"]];
const utf8 = (text: string) => new TextEncoder().encode(text);
function workbook(sheets: XLSX.WorkSheet[], bookType: "xlsx" | "biff8" = "xlsx", compression = false): Uint8Array {
  const book = XLSX.utils.book_new();
  sheets.forEach((sheet, i) => XLSX.utils.book_append_sheet(book, sheet, `Sheet${i}`));
  return new Uint8Array(XLSX.write(book, { type: "array", bookType, compression }));
}
function zip(compression = true) {
  return Buffer.from(workbook([XLSX.utils.aoa_to_sheet([["값", 4500]])], "xlsx", compression));
}
// SheetJS로 쓰면 선언 범위만큼 순회하므로, 만든 파일에서 범위 기록만 바꾼다.
function declareRange(data: Uint8Array, ref: string): Uint8Array {
  const file = XLSX.CFB.read(Buffer.from(data), { type: "buffer" });
  const index: number = file.FullPaths.findIndex((name: string) => name.endsWith("worksheets/sheet1.xml"));
  const xml = Buffer.from(file.FileIndex[index].content).toString("utf8");
  XLSX.CFB.utils.cfb_add(file, file.FullPaths[index], Buffer.from(xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${ref}"/>`)));
  return new Uint8Array(XLSX.CFB.write(file, { fileType: "zip", type: "buffer" }));
}
function declareBiffSize(data: Uint8Array, rows: number, cols: number, firstCol = 0): Uint8Array {
  const file = XLSX.CFB.read(Buffer.from(data), { type: "buffer" });
  const entry = XLSX.CFB.find(file, "Workbook");
  const content = Buffer.from(entry.content);
  // 첫 시트 Dimensions 레코드(0x0200, 14바이트)의 끝 행, 첫 열, 끝 열
  const at = content.indexOf(Buffer.from([0x00, 0x02, 0x0e, 0x00]));
  content.writeUInt32LE(rows, at + 8);
  content.writeUInt16LE(firstCol, at + 12);
  content.writeUInt16LE(cols, at + 14);
  entry.content = content;
  return new Uint8Array(XLSX.CFB.write(file, { type: "buffer" }));
}
function positions(data: Buffer) {
  const end = data.length - 22;
  const central = data.readUInt32LE(end + 16);
  return { end, central, local: data.readUInt32LE(central + 42) };
}
function expectError(run: () => unknown, message: string) {
  expect(run).toThrow(ParseError);
  expect(run).toThrow(message);
}

describe("readSheet", () => {
  it.each(["", "\ufeff"])("UTF-8 CSV와 BOM을 읽는다 (%s)", (bom) => {
    expect(readSheet(utf8(bom + "거래일자,가맹점명,이용금액\n2026-09-01,스타벅스,4500\n"), "a.csv")).toEqual(GRID);
  });
  it.each(["a.csv", "a.xls", "a.xlsx"])("EUC-KR을 확장자와 무관하게 읽는다: %s", (name) => expect(readSheet(EUC_KR_CSV, name)).toEqual(GRID));
  it("탭 구분 텍스트를 읽는다", () => {
    expect(readSheet(utf8("거래일자\t가맹점명\t이용금액\n2026-09-01\t스타벅스\t4500\n"), "a.xls")).toEqual(GRID);
  });
  it.each(["", "카드 이용내역\n\n"])("안내 줄 뒤의 탭과 금액 쉼표를 보존한다", (intro) => {
    const rows = readSheet(utf8(intro + "거래일자\t이용금액\n2026-09-01\t1,234,000\n"), "a.xls");
    expect(rows.slice(-2)).toEqual([["거래일자", "이용금액"], ["2026-09-01", "1,234,000"]]);
    if (intro) expect(rows[0].filter(Boolean)).toEqual(["카드 이용내역"]);
  });
  it.each([false, true])("BOM UTF-16 LE/BE를 읽는다 (%s)", (bigEndian) => {
    const data = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("거래일자\t금액\n2026-09-01\t4500\n", "utf16le")]);
    if (bigEndian) data.swap16();
    expect(readSheet(data, "a.xls")).toEqual([["거래일자", "금액"], ["2026-09-01", "4500"]]);
  });
  it("CSV 따옴표, 선행 0, 날짜 모양과 공백·빈 셀을 보존/정리한다", () => {
    expect(readSheet(utf8('코드,날짜,금액,빈칸\n 0012 ,2026.09.01,"1,234",\n,,,\n'), "a.csv")).toEqual([["코드", "날짜", "금액", "빈칸"], ["0012", "2026.09.01", "1,234", ""]]);
  });
  it.each(["yyyy-mm-dd", "m/d/yy"])("바이너리 숫자와 날짜를 표시 형식과 무관하게 읽는다 (%s)", (format) => {
    const sheet = XLSX.utils.aoa_to_sheet([[4500, 0, 0, 0]]);
    sheet.A1.z = "#,##0";
    sheet.B1 = { t: "n", v: 46266, z: format };
    sheet.C1 = { t: "n", v: 46266.604166666664, z: format + " hh:mm:ss" };
    sheet.D1 = { t: "n", v: 0.6041666666666666, z: format === "m/d/yy" ? "h:mm" : "hh:mm:ss" };
    expect(readSheet(workbook([sheet]), "a.xlsx")).toEqual([["4500", "2026-09-01", "2026-09-01 14:30:00", "14:30:00"]]);
  });
  it("biff8 한글과 숫자를 읽는다", () => expect(readSheet(workbook([XLSX.utils.aoa_to_sheet([["한글", 4500]])], "biff8"), "a.xls")).toEqual([["한글", "4500"]]));
  it("HTML 표의 숫자와 날짜도 문자열로 유지한다", () => {
    expect(readSheet(utf8("<table><tr><td> 가맹점 </td><td>0012</td><td>1,234</td><td>2026.09.01</td></tr></table>"), "a.xls")).toEqual([["가맹점", "0012", "1,234", "2026.09.01"]]);
  });
  it.each(["xlsx", "biff8"] as const)("%s에서 빈 첫 시트를 건너뛰고 빈 행을 제거한다", (type) => {
    expect(readSheet(workbook([XLSX.utils.aoa_to_sheet([]), XLSX.utils.aoa_to_sheet([[" 값 ", null], [], ["끝", ""]])], type), "a.xls")).toEqual([["값", ""], ["끝", ""]]);
  });
  it.each(["xlsx", "biff8"] as const)("%s 시트 수 상한을 적용한다", (type) => {
    const sheets = Array.from({ length: MAX_SHEETS }, () => XLSX.utils.aoa_to_sheet([["값"]]));
    expect(readSheet(workbook(sheets, type), "a.xlsx")).toEqual([["값"]]);
    expectError(() => readSheet(workbook([...sheets, sheets[0]], type), "a.xlsx"), DAMAGED);
  });
  it("선언된 범위가 칸 수 상한을 넘는 시트는 순회하지 않고 거부한다", () => {
    expect(MAX_CELLS).toBe(1_000_000);
    const book = (type: "xlsx" | "biff8" = "xlsx") => workbook([XLSX.utils.aoa_to_sheet([["값", 4500]])], type);
    const declare = (rows: number) => declareRange(book(), XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows - 1, c: 999 } }));
    const atLimit = readSheet(declare(MAX_CELLS / 1000), "a.xlsx");
    expect(atLimit).toHaveLength(1);
    expect(atLimit[0].filter(Boolean)).toEqual(["값", "4500"]);
    expectError(() => readSheet(declare(MAX_CELLS / 1000 + 1), "a.xlsx"), TOO_LARGE);
    expectError(() => readSheet(declareRange(book(), "A1:XFD1048576"), "a.xlsx"), TOO_LARGE);
    expectError(() => readSheet(declareBiffSize(book("biff8"), 65536, 256), "a.xls"), TOO_LARGE);
  });
  it("셀 없이 범위가 뒤집힌 시트는 훑지 않고 건너뛴다", () => {
    const data = declareBiffSize(workbook([XLSX.utils.aoa_to_sheet([]), XLSX.utils.aoa_to_sheet([["값"]])], "biff8"), 0xffffffff, 1, 1);
    const started = performance.now();
    expect(readSheet(data, "a.xls")).toEqual([["값"]]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it("내용 없는 HTML 표를 건너뛰고 다음 표를 읽는다", () => {
    expect(readSheet(utf8("<table></table><table><tr><td>값</td></tr></table>"), "a.xls")).toEqual([["값"]]);
  });
  it("칸 수 상한은 한 번에 읽은 시트를 합쳐서 센다", () => {
    // 내용 없이 400행 × 1000열을 차지하는 표
    const blank = "<table><tr><td>&nbsp;</td><td colspan=998></td><td>&nbsp;</td>" + "<tr>".repeat(398) + "<tr><td>&nbsp;</td></tr></table>";
    const html = (count: number) => utf8(blank.repeat(count) + "<table><tr><td>값</td></tr></table>");
    expect(readSheet(html(2), "a.xls")).toEqual([["값"]]);
    expectError(() => readSheet(html(3), "a.xls"), TOO_LARGE);
  });
  it("xlsx는 이름을 먼저 읽고 한 시트씩 만든다", () => {
    const data = workbook([XLSX.utils.aoa_to_sheet([]), XLSX.utils.aoa_to_sheet([["값"]])]);
    const spy = vi.spyOn(XLSX, "read");
    try {
      readSheet(data, "a.xlsx");
      expect(spy.mock.calls.map((call) => call[1])).toEqual([
        expect.objectContaining({ type: "buffer", bookSheets: true }),
        expect.objectContaining({ type: "buffer", sheets: 0 }),
        expect.objectContaining({ type: "buffer", sheets: 1 }),
      ]);
      expect(spy.mock.calls.every(([input]) => Buffer.isBuffer(input))).toBe(true);
    } finally { spy.mockRestore(); }
  });
  it("지원하지 않는 확장자와 빈 내용을 구분한다", () => {
    expectError(() => readSheet(utf8("값"), "a.pdf"), UNSUPPORTED_FORMAT_MESSAGE);
    for (const data of [new Uint8Array(), utf8(" \n\n"), workbook([XLSX.utils.aoa_to_sheet([])])]) expectError(() => readSheet(data, "a.xlsx"), EMPTY_FILE_MESSAGE);
  });
  it.each([new Uint8Array([0, 1, 2, 0xff, 0xfe, 0]), new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0])])("손상된 입력을 거부한다", (data) => expectError(() => readSheet(data, "a.xlsx"), DAMAGED));
  it("암호 오류를 한국어로 바꾼다", () => {
    const data = workbook([XLSX.utils.aoa_to_sheet([["값"]])]);
    const spy = vi.spyOn(XLSX, "read").mockImplementation(() => { throw new Error("File is password-protected"); });
    try { expectError(() => readSheet(data, "a.xlsx"), "비밀번호가 걸린 파일은 읽을 수 없어요. 비밀번호를 해제한 뒤 다시 올려 주세요."); }
    finally { spy.mockRestore(); }
  });
});

describe("assertZipWithinLimit", () => {
  it("한도 상수를 정의한다", () => expect(MAX_INFLATED_BYTES).toBe(20 * 1024 * 1024));
  it.each([true, false])("압축 여부 %s: 실제 크기와 엔트리당 256KB로 검사한다", (compression) => {
    const data = zip(compression);
    const n = data.readUInt16LE(positions(data).end + 8);
    expect(() => assertZipWithinLimit(data, 10 * 1024 * 1024)).not.toThrow();
    expectError(() => assertZipWithinLimit(data, 100), TOO_LARGE);
    expect(() => assertZipWithinLimit(data, n * 256 * 1024)).not.toThrow();
    expectError(() => assertZipWithinLimit(data, n * 256 * 1024 - 1), TOO_LARGE);
  });
  const mutations: [string, (data: Buffer, p: ReturnType<typeof positions>) => void][] = [
    ["압축 방식 불일치", (d, p) => d.writeUInt16LE(0, p.central + 10)],
    ["엔트리 수 불일치", (d, p) => d.writeUInt16LE(0, p.end + 10)],
    ["로컬 크기 변조", (d, p) => d.writeUInt32LE(1000000, p.local + 22)],
    ["중앙 크기 변조", (d, p) => d.writeUInt32LE(1000000, p.central + 24)],
    ["양쪽 크기 변조", (d, p) => { d.writeUInt32LE(1000000, p.local + 22); d.writeUInt32LE(1000000, p.central + 24); }],
    ["플래그 없는 0 크기", (d, p) => d.fill(0, p.local + 18, p.local + 26)],
    ["로컬 ZIP64 extra", (d, p) => { const len = d.readUInt16LE(p.local + 26); d.writeUInt16LE(len - 4, p.local + 26); d.writeUInt16LE(4, p.local + 28); d.set([1, 0, 0, 0], p.local + 30 + len - 4); }],
    ["중앙 ZIP64 extra", (d, p) => { const len = d.readUInt16LE(p.central + 28); d.writeUInt16LE(len - 4, p.central + 28); d.writeUInt16LE(4, p.central + 30); d.set([1, 0, 0, 0], p.central + 46 + len - 4); }],
    ["ZIP64 시작 위치", (d, p) => d.writeUInt32LE(0xffffffff, p.end + 16)],
    ["ZIP64 로컬 위치", (d, p) => d.writeUInt32LE(0xffffffff, p.central + 42)],
    ["ZIP64 압축 크기", (d, p) => d.writeUInt32LE(0xffffffff, p.central + 20)],
    ["ZIP64 원본 크기", (d, p) => d.writeUInt32LE(0xffffffff, p.central + 24)],
    ["로컬 시그니처", (d, p) => d.writeUInt32LE(0, p.local)],
    ["중앙 시그니처", (d, p) => d.writeUInt32LE(0, p.central)],
    ["지원하지 않는 방식", (d, p) => { d.writeUInt16LE(99, p.local + 8); d.writeUInt16LE(99, p.central + 10); }],
    ["범위 밖 데이터", (d, p) => { d.writeUInt32LE(d.length, p.central + 20); d.writeUInt32LE(d.length, p.local + 18); }],
    ["손상된 deflate", (d, p) => { const start = p.local + 30 + d.readUInt16LE(p.local + 26) + d.readUInt16LE(p.local + 28); d[start] = 0xff; }],
  ];
  it.each(mutations)("%s를 거부한다", (_, mutate) => {
    const data = zip(); mutate(data, positions(data));
    expectError(() => assertZipWithinLimit(data, 10 * 1024 * 1024), DAMAGED);
    expectError(() => readSheet(data, "a.xlsx"), DAMAGED);
  });
  it("스트림 deflate의 bit 3과 0 크기를 받는다", () => {
    const data = zip(); const { local } = positions(data);
    data.writeUInt16LE(8, local + 6); data.fill(0, local + 18, local + 26);
    expect(() => assertZipWithinLimit(data, 10 * 1024 * 1024)).not.toThrow();
  });
  it.each([0, 8])("저장 엔트리의 0 크기는 플래그 %s여도 거부한다", (flag) => {
    const data = zip(false); const { local } = positions(data);
    data.writeUInt16LE(flag, local + 6); data.writeUInt32LE(0, local + 18);
    expectError(() => assertZipWithinLimit(data, 10 * 1024 * 1024), DAMAGED);
  });
  it("잘린 EOCD와 없는 EOCD를 거부한다", () => {
    const data = zip();
    expectError(() => assertZipWithinLimit(data.subarray(0, data.length - 10), MAX_INFLATED_BYTES), DAMAGED);
    expectError(() => assertZipWithinLimit(utf8("값"), MAX_INFLATED_BYTES), DAMAGED);
  });
  it("실제 deflate 출력이 한도를 넘으면 즉시 거부한다", () => {
    const data = workbook([XLSX.utils.aoa_to_sheet(Array.from({ length: 50 }, () => ["a".repeat(30000)]))], "xlsx", true);
    expectError(() => assertZipWithinLimit(data, 2 * 1024 * 1024), TOO_LARGE);
  });
});
