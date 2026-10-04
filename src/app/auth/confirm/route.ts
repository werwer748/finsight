import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 확인 메일의 링크가 돌아오는 주소. 메일 템플릿에 따라 token_hash 또는 code가 붙어 온다.
export async function GET(request: NextRequest): Promise<never> {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  let confirmed = false;

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    confirmed = !error;
  } else if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    confirmed = !error;
  }

  redirect(confirmed ? "/dashboard" : "/login?notice=confirm-failed");
}
