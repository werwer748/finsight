import type { SupabaseClient } from "@supabase/supabase-js";
import type { CategorizedTransaction, MerchantCategory, Transaction } from "@/types/transaction";
import type { DateRange } from "@/types/dashboard";
import { recentMonthRange } from "@/lib/dashboard/period";
import { FALLBACK_CATEGORY, isMerchantCategory } from "./categories";
import { withFingerprints } from "./fingerprint";

// 요청에서 만든 로그인 세션 클라이언트를 받아 서버에서만 호출한다.
const PAGE_SIZE = 1000;
const WRITE_SIZE = 500;

export async function loadMerchantCache(
  supabase: SupabaseClient,
  userId: string,
): Promise<Map<string, MerchantCategory>> {
  const cache = new Map<string, MerchantCategory>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.from("merchant_categories")
      .select("merchant, category")
      .eq("user_id", userId)
      .order("merchant", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error("가맹점 분류를 불러오지 못했어요. 다시 시도해 주세요.");
    const rows = data ?? [];
    for (const row of rows) {
      if (isMerchantCategory(row.category)) cache.set(row.merchant, row.category);
    }
    if (rows.length < PAGE_SIZE) return cache;
  }
}

export async function saveMerchantCache(
  supabase: SupabaseClient,
  userId: string,
  entries: Map<string, MerchantCategory>,
): Promise<void> {
  const rows = [...entries].map(([merchant, category]) => ({ user_id: userId, merchant, category }));
  for (let offset = 0; offset < rows.length; offset += WRITE_SIZE) {
    const { error } = await supabase.from("merchant_categories")
      .upsert(rows.slice(offset, offset + WRITE_SIZE), {
        onConflict: "user_id,merchant", ignoreDuplicates: true,
      });
    if (error) throw new Error("가맹점 분류를 저장하지 못했어요. 다시 시도해 주세요.");
  }
}

export async function saveTransactions(
  supabase: SupabaseClient,
  userId: string,
  transactions: CategorizedTransaction[],
): Promise<{ inserted: number; duplicates: number }> {
  // 발생 횟수는 청크가 아니라 파일 전체에서 센다. 시각은 DB 행에서 제외한다.
  const rows = withFingerprints(transactions).map(({ date, merchant, amount, kind, category, fingerprint }) => ({
    user_id: userId, date, merchant, amount, kind, category, fingerprint,
  }));
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += WRITE_SIZE) {
    const chunk = rows.slice(offset, offset + WRITE_SIZE);
    const { data, error } = await supabase.from("transactions")
      .upsert(chunk, { onConflict: "user_id,fingerprint", ignoreDuplicates: true })
      .select("fingerprint");
    if (error) throw new Error("거래 내역을 저장하지 못했어요. 다시 시도해 주세요.");
    const newRows = data ?? [];
    inserted += newRows.length;
    const newFingerprints = new Set(newRows.map((row) => row.fingerprint));
    const corrections = chunk.filter((row) =>
      !newFingerprints.has(row.fingerprint) && row.category !== FALLBACK_CATEGORY,
    );
    if (corrections.length > 0) {
      const { error } = await supabase.from("transactions")
        .upsert(corrections, { onConflict: "user_id,fingerprint", ignoreDuplicates: false });
      if (error) throw new Error("거래 내역의 카테고리를 저장하지 못했어요. 다시 시도해 주세요.");
    }
  }
  return { inserted, duplicates: transactions.length - inserted };
}

export async function getRecentTransactions(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ range: DateRange; transactions: Transaction[] } | null> {
  const { data, error } = await supabase.from("transactions")
    .select("date")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(1);
  if (error) throw new Error("거래 내역을 불러오지 못했어요. 다시 시도해 주세요.");
  if (!data?.length) return null;
  const range = recentMonthRange(data[0].date);
  const transactions: Transaction[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.from("transactions")
      .select("id, date, merchant, amount, kind, category")
      .eq("user_id", userId)
      .gte("date", range.from)
      .lte("date", range.to)
      .order("date", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error("거래 내역을 불러오지 못했어요. 다시 시도해 주세요.");
    const rows = data ?? [];
    transactions.push(...rows as Transaction[]);
    if (rows.length < PAGE_SIZE) return { range, transactions };
  }
}

export async function countUploadsSince(
  supabase: SupabaseClient,
  userId: string,
  since: string,
): Promise<number> {
  const { count, error } = await supabase.from("uploads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (error || typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    throw new Error("업로드 횟수를 확인하지 못했어요. 다시 시도해 주세요.");
  }
  return count;
}

export async function recordUpload(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from("uploads").insert({ user_id: userId });
  if (error) throw new Error("업로드 기록을 저장하지 못했어요. 다시 시도해 주세요.");
}
