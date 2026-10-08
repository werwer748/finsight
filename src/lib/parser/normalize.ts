import type { ParsedTransaction, TransactionKind } from "@/types/transaction";
import { ParseError, type SheetGrid } from "./read-sheet";

const HEADER_ERROR = "거래 내역 표를 찾지 못했어요. 날짜, 내용, 금액 열이 있는 파일인지 확인해 주세요.";
const EMPTY_ERROR = "읽을 수 있는 거래가 없어요.";

function findColumns(row: string[]) {
  const headers = row.map((cell) => cell.replace(/\s/g, ""));
  const used = new Set<number>();
  function pick(keywords: string[], exclusions: string[] = []): number {
    for (const keyword of keywords) {
      const index = headers.findIndex((cell, i) => !used.has(i) && cell.includes(keyword) && !exclusions.some((word) => cell.includes(word)));
      if (index !== -1) {
        used.add(index);
        return index;
      }
    }
    return -1;
  }

  const date = pick(["거래일시", "거래일자", "거래일", "이용일시", "이용일자", "이용일", "승인일시", "승인일자", "승인일", "일자", "날짜", "일시"]);
  const merchant = pick(["가맹점", "이용하신곳", "이용처", "사용처", "기재내용", "거래내용", "내용", "받는분", "적요"], ["번호"]);
  // 입출금은 금액 키워드인 출금도 포함하므로 방향 역할을 먼저 확보한다.
  const direction = headers.findIndex((cell, i) => !used.has(i) && (cell === "구분" || cell.includes("입출")));
  if (direction !== -1) used.add(direction);
  const withdrawal = pick(["출금", "지급", "찾으신"], ["잔액", "구분", "수수료"]);
  const deposit = pick(["입금", "맡기신"], ["잔액", "구분", "수수료"]);
  const dual = withdrawal !== -1 && deposit !== -1;
  const amount = dual ? -1 : pick(["이용금액", "거래금액", "승인금액", "결제금액", "사용금액", "금액"], ["잔액", "할인", "수수료", "이자", "포인트", "적립", "예정"]);
  if (date === -1 || merchant === -1 || (!dual && amount === -1)) return null;

  const transactionType = pick(["거래구분", "거래유형", "적요"]);
  // 잔액은 역할만 확보하며 거래 결과로 읽어 오지 않는다.
  pick(["잔액"]);
  const time = pick(["거래시간", "이용시간", "승인시간", "시간", "시각"]);
  const card = !dual && [date, merchant, amount].some((index) => /이용|승인|결제|사용|가맹점/.test(headers[index]));
  return { date, merchant, withdrawal, deposit, dual, amount, transactionType, direction, time, card };
}

function readAmount(value: string): number | null {
  const cleaned = value.replace(/[,\s원₩]/g, "");
  // 입출금 분리형은 해당 없는 열을 기호만으로 채우기도 한다.
  if (cleaned === "" || cleaned === "-" || cleaned === "–") return 0;
  if (!/^[+-]?\d+(\.0+)?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return Number.isSafeInteger(amount) ? amount : null;
}

function readDate(value: string): { date: string; remainder: string } | null {
  const match = /^(\d{4})(?:([-./])(\d{1,2})\2(\d{1,2})|(\d{2})(\d{2})|년\s*(\d{1,2})월\s*(\d{1,2})일)/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[3] ?? match[5] ?? match[7]);
  const day = Number(match[4] ?? match[6] ?? match[8]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  return {
    date: `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    remainder: value.trim().slice(match[0].length),
  };
}

function timeMatch(value: string): RegExpExecArray | null {
  return /(?<!\d)(\d{1,2}):(\d{2})(?::\d{2})?(?!\d)/.exec(value);
}

function readTime(dateRemainder: string, separate: string): string | null {
  const match = timeMatch(dateRemainder) ?? timeMatch(separate);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

export function normalizeRows(grid: SheetGrid): ParsedTransaction[] {
  let headerIndex = -1;
  let columns: ReturnType<typeof findColumns> = null;
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    columns = findColumns(grid[i]);
    if (columns) {
      headerIndex = i;
      break;
    }
  }
  if (!columns) throw new ParseError(HEADER_ERROR);

  const result: ParsedTransaction[] = [];
  for (const row of grid.slice(headerIndex + 1)) {
    const cell = (index: number) => row[index] ?? "";
    const date = readDate(cell(columns.date));
    if (!date) continue;
    let amount: number;
    let kind: TransactionKind;
    if (columns.dual) {
      const withdrawal = readAmount(cell(columns.withdrawal));
      const deposit = readAmount(cell(columns.deposit));
      if (withdrawal === null || deposit === null) continue;
      amount = withdrawal !== 0 ? withdrawal : deposit;
      kind = withdrawal !== 0 ? "expense" : "income";
    } else {
      const parsed = readAmount(cell(columns.amount));
      if (parsed === null) continue;
      amount = parsed;
      if (columns.card) kind = "expense";
      else {
        const direction = cell(columns.direction).trim();
        if (direction.includes("입금") || direction === "입") kind = "income";
        else if (/출금|지급/.test(direction) || direction === "출") kind = "expense";
        else kind = amount < 0 ? "expense" : "income";
        amount = Math.abs(amount);
      }
    }
    if (amount === 0) continue;
    const isTransfer = !columns.card && !cell(columns.transactionType).includes("체크");
    if (!columns.card && !isTransfer && kind === "income") {
      kind = "expense";
      amount = -Math.abs(amount);
    }
    result.push({
      date: date.date,
      time: readTime(date.remainder, cell(columns.time)),
      merchant: cell(columns.merchant).trim().replace(/\s+/g, " "),
      amount, kind, isTransfer,
    });
  }
  if (result.length === 0) throw new ParseError(EMPTY_ERROR);
  return result;
}
