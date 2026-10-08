import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ParseError, readSheet } from "@/lib/parser/read-sheet";
import { normalizeRows } from "@/lib/parser/normalize";
import { classifyTransactions } from "@/lib/classify/classify-transactions";
import {
  countUploadsSince,
  recordUpload,
  loadMerchantCache,
  saveMerchantCache,
  saveTransactions,
} from "@/lib/transactions/store";
import {
  MAX_TRANSACTIONS_PER_UPLOAD,
  MAX_UPLOADS_PER_DAY,
  maxAllowedDate,
  validateUploadFile,
} from "@/lib/upload/validate";
import { classifyMerchants } from "@/services/claude";
import type { UploadErrorBody, UploadResult } from "@/types/upload";

export const maxDuration = 60;

const LIMIT_MESSAGE = "하루에 올릴 수 있는 횟수를 넘었어요. 내일 다시 시도해 주세요.";

function errorResponse(error: string, status: number): Response {
  return Response.json({ error } satisfies UploadErrorBody, { status });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return errorResponse("로그인이 필요해요.", 401);

    const supabase = await createClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    if (await countUploadsSince(supabase, user.id, since) >= MAX_UPLOADS_PER_DAY) {
      return errorResponse(LIMIT_MESSAGE, 429);
    }
    // 본문을 읽기 전에 기록하고 다시 세어 동시에 들어온 요청에도 상한을 적용한다.
    await recordUpload(supabase, user.id);
    if (await countUploadsSince(supabase, user.id, since) > MAX_UPLOADS_PER_DAY) {
      return errorResponse(LIMIT_MESSAGE, 429);
    }

    let file: FormDataEntryValue | null;
    try {
      file = (await request.formData()).get("file");
    } catch {
      return errorResponse("파일을 선택해 주세요.", 400);
    }
    if (!(file instanceof File)) return errorResponse("파일을 선택해 주세요.", 400);
    const validationError = validateUploadFile(file);
    if (validationError) return errorResponse(validationError, 400);

    const data = new Uint8Array(await file.arrayBuffer());
    const parsed = normalizeRows(readSheet(data, file.name));
    if (parsed.length > MAX_TRANSACTIONS_PER_UPLOAD) {
      return errorResponse("한 번에 올릴 수 있는 거래는 5,000건까지예요. 기간을 나눠서 올려 주세요.", 400);
    }
    const latestAllowed = maxAllowedDate(new Date());
    if (parsed.some(({ date }) => date > latestAllowed)) {
      return errorResponse("미래 날짜의 거래가 들어 있어요. 파일의 날짜를 확인해 주세요.", 400);
    }

    const { transactions, unclassified } = await classifyTransactions(parsed, {
      loadCache: () => loadMerchantCache(supabase, user.id),
      classify: classifyMerchants,
      saveCache: (entries) => saveMerchantCache(supabase, user.id, entries),
    });
    const { inserted, duplicates } = await saveTransactions(supabase, user.id, transactions);
    return Response.json({ total: parsed.length, inserted, duplicates, unclassified } satisfies UploadResult);
  } catch (error) {
    if (error instanceof ParseError) return errorResponse(error.message, 400);
    // 예외의 message와 stack에는 파일·거래 정보가 섞일 수 있어 예외의 이름만 기록한다.
    console.error(`업로드를 처리하지 못했어요. 오류 종류: ${error instanceof Error ? error.name : "알 수 없음"}`);
    return errorResponse("업로드를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.", 500);
  }
}
