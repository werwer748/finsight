import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// RLS를 우회하는 secret key 클라이언트. 사용자 세션 없이 도는 서버 코드(on-call 웹훅)에서만 쓴다.
// 사용자 데이터 테이블에는 쓰지 않는다. 그쪽은 로그인 세션 클라이언트(server.ts)로 RLS를 거친다.
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !secretKey && "SUPABASE_SECRET_KEY",
    ].filter(Boolean);
    throw new Error(
      `Supabase 환경변수가 설정되지 않았습니다: ${missing.join(", ")}`,
    );
  }

  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
