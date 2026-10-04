import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/lib/supabase/env";

// 서버 컴포넌트, 서버 액션, 라우트 핸들러에서 쓰는 클라이언트. 요청마다 새로 만든다.
export async function createClient(): Promise<SupabaseClient> {
  const { url, publishableKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없어 예외가 난다.
          // 세션 갱신은 proxy가 담당하므로 무시한다.
        }
      },
    },
  });
}
