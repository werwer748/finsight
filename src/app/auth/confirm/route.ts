import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { after, type NextRequest } from "next/server";
import {
  flushPostHogLogs,
  logAuthEvent,
  logAuthFailure,
} from "@/lib/posthog/logs";
import { createClient } from "@/lib/supabase/server";

// 확인 메일의 링크가 돌아오는 주소. 메일 템플릿에 따라 token_hash 또는 code가 붙어 온다.
export async function GET(request: NextRequest): Promise<never> {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  let confirmed = false;
  // 링크에 필요한 값이 없으면 Supabase를 부르지 않으므로 실패 사유를 직접 정한다.
  let failureCode: string | undefined = "missing_params";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    confirmed = !error;
    failureCode = error?.code;
  } else if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    confirmed = !error;
    failureCode = error?.code;
  }

  if (confirmed) {
    logAuthEvent(
      "Authentication email confirmation succeeded",
      "email_confirmation",
    );
  } else {
    logAuthFailure(
      "Authentication email confirmation failed",
      "email_confirmation",
      failureCode,
    );
  }
  after(flushPostHogLogs);

  redirect(confirmed ? "/dashboard" : "/login?notice=confirm-failed");
}
