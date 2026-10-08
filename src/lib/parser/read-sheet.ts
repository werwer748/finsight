import { inflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import {
  EMPTY_FILE_MESSAGE,
  UNSUPPORTED_FORMAT_MESSAGE,
  hasSupportedExtension,
} from "./file-rules";

export type SheetGrid = string[][];

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export const MAX_INFLATED_BYTES = 20 * 1024 * 1024;
export const MAX_SHEETS = 20;
export const MAX_CELLS = 1_000_000;
const MIN_ENTRY_BYTES = 256 * 1024;
const DAMAGED_MESSAGE = "파일을 읽지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.";
const TOO_LARGE_MESSAGE = "파일 내용이 너무 커요. 기간을 나눠서 올려 주세요.";
const PASSWORD_MESSAGE = "비밀번호가 걸린 파일은 읽을 수 없어요. 비밀번호를 해제한 뒤 다시 올려 주세요.";

function damaged(): never {
  throw new ParseError(DAMAGED_MESSAGE);
}

export function assertZipWithinLimit(data: Uint8Array, limit: number): void {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  function range(start: number, size: number) {
    if (start < 0 || size < 0 || start + size > buffer.length) damaged();
  }
  function u16(start: number) { range(start, 2); return buffer.readUInt16LE(start); }
  function u32(start: number) { range(start, 4); return buffer.readUInt32LE(start); }
  function size32(start: number) {
    const value = u32(start);
    if (value === 0xffffffff) damaged();
    return value;
  }
  function extra(start: number, size: number) {
    range(start, size);
    const end = start + size;
    while (start + 4 <= end) {
      const id = u16(start);
      const length = u16(start + 2);
      if (id === 0x0001 || start + 4 + length > end) damaged();
      start += 4 + length;
    }
  }

  let end = buffer.length - 4;
  while (end >= 0 && u32(end) !== 0x06054b50) end--;
  if (end < 0) damaged();
  range(end, 22);
  const count = u16(end + 8);
  if (count !== u16(end + 10)) damaged();
  let central = size32(end + 16);
  let total = 0;
  for (let i = 0; i < count; i++) {
    range(central, 46);
    if (u32(central) !== 0x02014b50) damaged();
    const method = u16(central + 10);
    const compressed = size32(central + 20);
    const inflated = size32(central + 24);
    const nameLength = u16(central + 28);
    const extraLength = u16(central + 30);
    const commentLength = u16(central + 32);
    const local = size32(central + 42);
    range(central + 46, nameLength + extraLength + commentLength);
    extra(central + 46 + nameLength, extraLength);

    range(local, 30);
    if (u32(local) !== 0x04034b50 || u16(local + 8) !== method) damaged();
    if (method !== 0 && method !== 8) damaged();
    const flags = u16(local + 6);
    const localCompressed = size32(local + 18);
    const localInflated = size32(local + 22);
    // 스트림 출력(bit 3)은 deflate 로컬 헤더의 크기에만 0을 허용한다.
    const streaming = method === 8 && (flags & 0x0008) !== 0;
    if (localCompressed !== compressed && !(streaming && localCompressed === 0)) damaged();
    if (localInflated !== inflated && !(streaming && localInflated === 0)) damaged();
    const localNameLength = u16(local + 26);
    const localExtraLength = u16(local + 28);
    range(local + 30, localNameLength + localExtraLength);
    extra(local + 30 + localNameLength, localExtraLength);
    const start = local + 30 + localNameLength + localExtraLength;
    range(start, compressed);

    let actual = compressed;
    if (method === 8) {
      try {
        actual = inflateRawSync(buffer.subarray(start, start + compressed), {
          maxOutputLength: limit - total + 1,
        }).length;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE") {
          throw new ParseError(TOO_LARGE_MESSAGE);
        }
        damaged();
      }
    }
    total += Math.max(actual, MIN_ENTRY_BYTES);
    if (total > limit) throw new ParseError(TOO_LARGE_MESSAGE);
    if (actual !== inflated) damaged();
    central += 46 + nameLength + extraLength + commentLength;
  }
}

function startsWith(data: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => data[index] === byte);
}

function decodeText(data: Uint8Array): string {
  let text: string;
  if (startsWith(data, [0xef, 0xbb, 0xbf])) text = new TextDecoder("utf-8").decode(data);
  else if (startsWith(data, [0xff, 0xfe])) text = new TextDecoder("utf-16le").decode(data);
  else if (startsWith(data, [0xfe, 0xff])) text = new TextDecoder("utf-16be").decode(data);
  else {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); }
    catch { text = new TextDecoder("euc-kr").decode(data); }
  }
  text = text.replace(/^\uFEFF/, "");
  if (text.includes("\u0000")) damaged();
  return text;
}

function cellString(cell: XLSX.CellObject | undefined, date1904: boolean): string {
  if (!cell || cell.v == null) return "";
  if (cell.t === "n" && typeof cell.v === "number" && cell.z && XLSX.SSF.is_date(cell.z)) {
    const date = XLSX.SSF.parse_date_code(cell.v, { date1904 });
    if (!date) damaged();
    const pad = (value: number) => String(value).padStart(2, "0");
    const time = `${pad(date.H)}:${pad(date.M)}:${pad(date.S)}`;
    if (cell.v >= 0 && cell.v < 1) return time;
    const day = `${String(date.y).padStart(4, "0")}-${pad(date.m)}-${pad(date.d)}`;
    return date.H || date.M || date.S ? `${day} ${time}` : day;
  }
  return String(cell.v).trim();
}

function firstGrid(book: XLSX.WorkBook): SheetGrid | undefined {
  let cells = 0;
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (!sheet?.["!ref"]) continue;
    const region = XLSX.utils.decode_range(sheet["!ref"]);
    // 좌표가 안전한 정수 범위를 넘으면 row++가 값을 올리지 못해 순회가 끝나지 않는다.
    if (![region.s.r, region.s.c, region.e.r, region.e.c].every(Number.isSafeInteger)) throw new ParseError(TOO_LARGE_MESSAGE);
    const rows = region.e.r - region.s.r + 1;
    const cols = region.e.c - region.s.c + 1;
    // 셀이 없는 시트는 범위가 뒤집혀 나오기도 한다.
    if (rows <= 0 || cols <= 0) continue;
    // SheetJS는 파일이 선언한 범위를 실제 셀과 맞춰 보지 않으므로 순회하기 전에 칸 수를 제한한다. 시트를 합쳐서 센다.
    cells += rows * cols;
    if (cells > MAX_CELLS) throw new ParseError(TOO_LARGE_MESSAGE);
    const grid: SheetGrid = [];
    for (let row = region.s.r; row <= region.e.r; row++) {
      const values: string[] = [];
      for (let col = region.s.c; col <= region.e.c; col++) {
        values.push(cellString(sheet[XLSX.utils.encode_cell({ r: row, c: col })], book.Workbook?.WBProps?.date1904 === true));
      }
      if (values.some((value) => value !== "")) grid.push(values);
    }
    if (grid.length) return grid;
  }
}

export function readSheet(data: Uint8Array, fileName: string): SheetGrid {
  if (!hasSupportedExtension(fileName)) throw new ParseError(UNSUPPORTED_FORMAT_MESSAGE);
  if (data.length === 0) throw new ParseError(EMPTY_FILE_MESSAGE);
  try {
    const zip = startsWith(data, [0x50, 0x4b, 0x03, 0x04]);
    const ole = startsWith(data, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    if (zip) assertZipWithinLimit(data, MAX_INFLATED_BYTES);
    if (zip || ole) {
      const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      const options: XLSX.ParsingOptions = { type: "buffer", cellNF: true, cellDates: false };
      const names = XLSX.read(buffer, { ...options, bookSheets: true }).SheetNames;
      if (names.length > MAX_SHEETS) damaged();
      for (let i = 0; i < names.length; i++) {
        const grid = firstGrid(XLSX.read(buffer, { ...options, sheets: i }));
        if (grid) return grid;
        // biff8은 sheets를 무시하고 모든 시트를 만들므로 다시 읽지 않는다.
        if (ole) break;
      }
    } else {
      const text = decodeText(data);
      const tabDelimited = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== "").slice(0, 30).some((line) => line.includes("\t"));
      const grid = firstGrid(XLSX.read(text, { type: "string", raw: true, ...(tabDelimited ? { FS: "\t" } : {}) }));
      if (grid) return grid;
    }
    throw new ParseError(EMPTY_FILE_MESSAGE);
  } catch (error) {
    if (error instanceof ParseError) throw error;
    if (error instanceof Error && /password|encrypt/i.test(error.message)) throw new ParseError(PASSWORD_MESSAGE);
    damaged();
  }
}
