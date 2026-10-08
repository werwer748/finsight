// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeRows } from "./normalize";
import { ParseError } from "./read-sheet";

const HEADER_ERROR = "거래 내역 표를 찾지 못했어요. 날짜, 내용, 금액 열이 있는 파일인지 확인해 주세요.";
const EMPTY_ERROR = "읽을 수 있는 거래가 없어요.";
const bankHeader = ["거래일시", "적요", "기재내용", "출금(원)", "입금(원)", "거래후 잔액(원)"];

describe("normalizeRows", () => {
  it("은행 이중 금액형의 종류, 카드 결제와 취소를 구별한다", () => {
    const grid: string[][] = [bankHeader,
      ["2026-09-01", "타행이체", "홍길동", "50000", "", "100000"],
      ["2026-09-02", "전자금융", "홍길동", "10000", "", "90000"],
      ["2026-09-03", "모바일", "홍길동", "10000", "", "80000"],
      ["2026-09-04", "카드대금", "카드 대금", "20000", "", "60000"],
      ["2026-09-05", "체크카드", "어린이체험관", "4500", "", "55500"],
      ["2026-09-06", "입금", "급여", "", "30000", "85500"],
      ["2026-09-07", "체크카드", "어린이체험관", "", "4,500", "90000"],
    ];
    expect(normalizeRows(grid)).toEqual(grid.slice(1).map((row, i) => ({
      date: row[0], time: null, merchant: row[2],
      amount: [50000, 10000, 10000, 20000, 4500, 30000, -4500][i],
      kind: i === 5 ? "income" : "expense", isTransfer: i !== 4 && i !== 6,
    })));
  });

  it("이중 금액형은 카드 헤더보다 우선하고 출금이 입금보다 우선한다", () => {
    expect(normalizeRows([["이용일", "가맹점", "출금", "입금"], ["2026-09-01", "상점", "-100", "200"]])[0])
      .toMatchObject({ amount: -100, kind: "expense", isTransfer: true });
  });

  it.each(["출금", "지급", "출", "입금", "입", "매입", "일시불", ""])("은행 방향 값 %s를 부호보다 먼저 해석한다", (direction) => {
    const grid: string[][] = [["거래일시", "구분", "거래금액", "거래 후 잔액", "거래구분", "내용"],
      ["2026-09-01", direction, "-4,500", "90000", "전자금융", "홍길동"]];
    expect(normalizeRows(grid)[0]).toEqual({ date: "2026-09-01", time: null, merchant: "홍길동", amount: 4500,
      kind: ["입금", "입"].includes(direction) ? "income" : "expense", isTransfer: true });
  });

  it("입출을 포함하는 방향 헤더와 양수 출금도 읽는다", () => {
    expect(normalizeRows([["날짜", "내용", "금액", "입출방향"], ["2026-09-01", "홍길동", "+3000", "출금"]])[0])
      .toMatchObject({ amount: 3000, kind: "expense", isTransfer: true });
  });

  it("입출금 방향 헤더를 출금 금액 열로 사용하지 않는다", () => {
    const single: string[][] = [["날짜", "내용", "금액", "입출금"], ["2026-09-01", "홍길동", "3000", "출금"]];
    expect(normalizeRows(single)[0]).toMatchObject({ amount: 3000, kind: "expense", isTransfer: true });
    const dual: string[][] = [["날짜", "내용", "입출금", "출금액", "입금액"], ["2026-09-01", "홍길동", "출금", "3000", ""]];
    expect(normalizeRows(dual)[0]).toMatchObject({ amount: 3000, kind: "expense", isTransfer: true });
  });

  it("은행 단일 금액형의 체크카드 취소 입금도 음수 지출이다", () => {
    const grid: string[][] = [["거래일시", "적요", "거래 유형", "거래 금액"], ["2026-09-01", "상점", "체크카드", "+4500"]];
    expect(normalizeRows(grid)[0]).toMatchObject({ kind: "expense", amount: -4500, isTransfer: false });
  });

  it("은행 부호형은 공백을 없앤 헤더와 별도 거래유형을 읽는다", () => {
    const grid: string[][] = [["거래 일시", "적요", "거래 유형", "거래 금액", "거래 후 잔액"],
      ["2026-09-01", "  서울대체육관  ", "체크카드", "-4500", "90000"],
      ["2026-09-02", "홍길동", "입금", "+3000", "93000"]];
    expect(normalizeRows(grid).map(({ merchant, amount, kind, isTransfer }) => ({ merchant, amount, kind, isTransfer })))
      .toEqual([{ merchant: "서울대체육관", amount: 4500, kind: "expense", isTransfer: false },
        { merchant: "홍길동", amount: 3000, kind: "income", isTransfer: true }]);
  });

  it("카드형은 할인금액을 무시하고 취소 부호와 가맹점명을 보존한다", () => {
    const grid: string[][] = [["이용일자", "이용카드", "가맹점명", "이용금액", "할인금액"],
      ["2026-09-01", "1234", "어린이체험관", "12000", "1000"],
      ["2026-09-02", "1234", "서울대체육관", "-12,000", "1000"]];
    expect(normalizeRows(grid)).toEqual([
      { date: "2026-09-01", time: null, merchant: "어린이체험관", amount: 12000, kind: "expense", isTransfer: false },
      { date: "2026-09-02", time: null, merchant: "서울대체육관", amount: -12000, kind: "expense", isTransfer: false },
    ]);
  });

  it("카드 잔액과 방향은 종류 판정에 사용하지 않는다", () => {
    const grid: string[][] = [["이용일", "이용가맹점", "이용금액", "할부개월", "결제후잔액"],
      ["2026-09-01", "상점", "12000", "3", "24000"]];
    expect(normalizeRows(grid)[0]).toMatchObject({ amount: 12000, kind: "expense", isTransfer: false });
    const directions: string[][] = [["이용일자", "구분", "가맹점명", "이용금액"],
      ["2026-09-01", "일시불", "상점", "12000"], ["2026-09-02", "매입", "상점", "12000"],
      ["2026-09-03", "입금", "상점", "12000"]];
    expect(normalizeRows(directions).every((row) => row.kind === "expense" && !row.isTransfer)).toBe(true);
  });

  it("거래구분 없는 은행은 내용과 무관하게 모두 이체다", () => {
    const grid: string[][] = [["거래일시", "내용", "출금", "입금", "잔액"],
      ["2026-09-01", "스타벅스", "4500", "", "90000"],
      ["2026-09-02", "체크카드", "", "4500", "94500"]];
    expect(normalizeRows(grid).map((row) => row.isTransfer)).toEqual([true, true]);
  });

  it("잔액과 방향이 없는 일반 단일 금액형도 은행으로 읽는다", () => {
    const grid: string[][] = [["거래일시", "거래구분", "내용", "거래금액"],
      ["2026-09-01", "이체", "홍길동", "-50,000"], ["2026-09-02", "입금", "홍길동", "50000"]];
    expect(normalizeRows(grid).map(({ kind, amount, isTransfer }) => ({ kind, amount, isTransfer })))
      .toEqual([{ kind: "expense", amount: 50000, isTransfer: true }, { kind: "income", amount: 50000, isTransfer: true }]);
  });

  it("내용으로 쓰인 적요는 거래구분으로 재사용하지 않는다", () => {
    expect(normalizeRows([["날짜", "적요", "금액"], ["2026-09-01", "체크카드", "4500"]])[0])
      .toMatchObject({ kind: "income", isTransfer: true });
  });

  it("안내와 합계는 버리고 첫 유효 헤더 아래의 행만 읽는다", () => {
    const grid: string[][] = [["계좌 안내"], ["조회 기간"], ["거래일시", "내용"], bankHeader,
      ["2026-09-01", "체크카드", "  상점\t  지점  ", "4500", "", "90000"], ["합계", "", "", "4500"]];
    expect(normalizeRows(grid)).toEqual([{ date: "2026-09-01", time: null, merchant: "상점 지점", amount: 4500, kind: "expense", isTransfer: false }]);
  });

  it("30번째 행까지 헤더를 찾고 31번째는 찾지 않는다", () => {
    const intro: string[][] = Array.from({ length: 29 }, () => ["안내"]);
    const rows: string[][] = [["날짜", "내용", "금액"], ["2026-09-01", "", "100"]];
    expect(normalizeRows([...intro, ...rows])).toHaveLength(1);
    expect(() => normalizeRows([...intro, ["안내"], ...rows])).toThrow(HEADER_ERROR);
  });

  it("키워드 우선순위와 제외어를 적용하고 같은 키워드는 왼쪽 열을 쓴다", () => {
    const grid: string[][] = [["날짜", "거래일시", "가맹점번호", "내용", "이용하신 곳", "이용하신곳 지점",
      "잔액금액", "할인금액", "수수료금액", "이자금액", "포인트금액", "적립금액", "예정금액", "금액", "이용금액"],
      ["잘못된 날짜", "2026-09-01", "1234", "내용", "상점", "다른 상점", "1", "2", "3", "4", "5", "6", "7", "100", "200"]];
    expect(normalizeRows(grid)[0]).toMatchObject({ date: "2026-09-01", merchant: "상점", amount: 200 });
  });

  it("출입금 제외어와 지급·맡기신 별칭을 적용한다", () => {
    const grid: string[][] = [["날짜", "내용", "출금잔액", "출금구분", "출금수수료", "지급", "입금잔액", "입금구분", "입금수수료", "맡기신"],
      ["2026-09-01", "홍길동", "999", "999", "999", "100", "999", "999", "999", ""]];
    expect(normalizeRows(grid)[0]).toMatchObject({ amount: 100, kind: "expense", isTransfer: true });
  });

  it.each(["2026-9-1", "2026.9.1", "2026/9/1", "20260901", "2026년 9월 1일 안내"])("날짜 형식 %s를 정규화한다", (date) => {
    expect(normalizeRows([["날짜", "내용", "금액"], [date, "상점", "100"]])[0].date).toBe("2026-09-01");
  });

  it.each(["2026-13-01", "2026-02-30", "2026-04-31", "2026-00-01", "2026-09-00", "1900-02-29", "안내"])("잘못된 날짜 %s 행을 버린다", (date) => {
    expect(normalizeRows([["날짜", "내용", "금액"], [date, "상점", "100"], ["2000-02-29", "", "200"]]))
      .toEqual([{ date: "2000-02-29", time: null, merchant: "", amount: 200, kind: "income", isTransfer: true }]);
  });

  it.each([
    ["2026-09-01 14:30:00", "", "14:30"], ["2026.09.01 9:05", "", "09:05"],
    ["2026-09-01", "14:30:00", "14:30"], ["2026-09-01", "", null],
    ["2026-09-01 25:00", "", null], ["2026-09-01 14:60", "", null],
    ["2026-09-01 9:05", "10:30", "09:05"], ["2026-09-01", "시각 0:00", "00:00"],
    ["2026-09-01 25:00", "10:30", null], ["2026-09-01", "23:59:00", "23:59"],
  ])("날짜 %s, 별도 시각 %s를 시간대 없이 읽는다", (date, time, expected) => {
    const grid: string[][] = [["거래일시", "내용", "금액", "거래시간"], [date, "상점", "100", time ?? ""]];
    expect(normalizeRows(grid)[0]).toMatchObject({ date: "2026-09-01", time: expected });
  });

  it.each([["1,234,000원", 1234000], ["₩ 4 500", 4500], ["4500.00", 4500], ["+3000", 3000]])("정수 금액 %s를 읽는다", (value, amount) => {
    expect(normalizeRows([["날짜", "가맹점", "금액"], ["2026-09-01", "상점", String(value)]])[0].amount).toBe(amount);
  });

  it.each(["", "0", "-0", "abc", "4500.01", "1e3", "Infinity"])("금액 %s 행을 버린다", (amount) => {
    expect(normalizeRows([["날짜", "내용", "금액"], ["2026-09-01", "상점", amount], ["2026-09-02", "상점", "100"]])).toHaveLength(1);
  });

  it("이중 금액형에서 읽을 수 없는 금액과 0인 행을 버린다", () => {
    const grid: string[][] = [bankHeader, ["2026-09-01", "", "", "abc", "100"],
      ["2026-09-01", "", "", "100", "abc"], ["2026-09-01", "", "", "", ""],
      ["2026-09-02", "", "", "", "100"]];
    expect(normalizeRows(grid)).toHaveLength(1);
  });

  it.each(["-", "–"])("이중 금액형에서 기호 %s만 있는 칸은 빈 칸으로 읽는다", (blank) => {
    const grid: string[][] = [bankHeader,
      ["2026-09-01", "타행이체", "홍길동", "50000", blank, "100000"],
      ["2026-09-02", "입금", "급여", blank, "30000", "130000"],
      ["2026-09-03", "입금", "급여", blank, blank, "130000"]];
    expect(normalizeRows(grid)).toMatchObject([
      { date: "2026-09-01", amount: 50000, kind: "expense" },
      { date: "2026-09-02", amount: 30000, kind: "income" },
    ]);
  });

  it.each([[], [["날짜", "내용"]], [["날짜내용금액"], ["2026-09-01"]]].map((grid) => ({ grid })))("유효 헤더가 없으면 정해진 ParseError를 던진다", ({ grid }) => {
    expect(() => normalizeRows(grid)).toThrow(ParseError);
    expect(() => normalizeRows(grid)).toThrow(HEADER_ERROR);
  });

  it.each(["매입", "일시불"])("은행의 알 수 없는 방향 %s는 양수 부호로 판단한다", (direction) => {
    expect(normalizeRows([["날짜", "내용", "금액", "구분"], ["2026-09-01", "홍길동", "3000", direction]])[0])
      .toMatchObject({ kind: "income", amount: 3000, isTransfer: true });
  });

  it.each(["이용시간", "승인시간", "시간", "시각"])("시각 별칭 %s를 읽는다", (header) => {
    expect(normalizeRows([["날짜", "내용", "금액", header], ["2026-09-01", "상점", "100", "9:05"]])[0].time).toBe("09:05");
  });

  it("헤더만 있거나 모든 행이 무효면 정해진 ParseError를 던진다", () => {
    for (const grid of [[["날짜", "내용", "금액"]], [["날짜", "내용", "금액"], ["합계", "", "100"]]]) {
      expect(() => normalizeRows(grid)).toThrow(ParseError);
      expect(() => normalizeRows(grid)).toThrow(EMPTY_ERROR);
    }
  });

  it("결과에 거래 필드만 담고 입력을 수정하지 않는다", () => {
    const grid: string[][] = [["날짜", "내용", "금액", "계좌번호", "카드번호", "잔액"], ["2026-09-01", "상점", "100", "1234", "5678", "9999"]];
    const original = grid.map((row) => [...row]);
    expect(Object.keys(normalizeRows(grid)[0]).sort()).toEqual(["amount", "date", "isTransfer", "kind", "merchant", "time"]);
    expect(grid).toEqual(original);
  });
});
