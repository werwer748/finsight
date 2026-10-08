import type {
  INCOME_CATEGORY,
  MERCHANT_CATEGORIES,
  TRANSFER_CATEGORY,
} from "@/lib/transactions/categories";

export type MerchantCategory = (typeof MERCHANT_CATEGORIES)[number];
export type Category =
  | MerchantCategory
  | typeof TRANSFER_CATEGORY
  | typeof INCOME_CATEGORY;

export type TransactionKind = "expense" | "income";

// 파일에서 읽어 정규화한 거래 한 건. 아직 카테고리가 없다.
export type ParsedTransaction = {
  date: string; // YYYY-MM-DD. 파일의 날짜 그대로이며 시간대 변환을 하지 않는다.
  time: string | null; // HH:mm. 24시간제 두 자리. 시각이 없으면 null.
  merchant: string; // 가맹점명 또는 적요. 빈 문자열일 수 있다.
  amount: number; // 원 단위 정수. 취소·환불은 음수다.
  kind: TransactionKind;
  isTransfer: boolean; // 카드 결제로 확인되지 않은 은행 출금. LLM에 보내지 않는다.
};

// 카테고리가 붙은 거래. time을 뺀 나머지가 DB에 저장된다.
export type CategorizedTransaction = {
  date: string;
  time: string | null;
  merchant: string;
  amount: number;
  kind: TransactionKind;
  category: Category;
};

// DB에서 읽은 거래. 시각은 중복 판별 지문에만 쓰고 저장하지 않는다.
export type Transaction = Omit<CategorizedTransaction, "time"> & { id: string };
