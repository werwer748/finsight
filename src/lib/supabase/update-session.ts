import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, hasSupabaseEnv } from "@/lib/supabase/env";

// 요청마다 세션 토큰을 갱신하고, 갱신된 쿠키가 담긴 응답과 로그인 여부를 돌려준다.
export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; isAuthenticated: boolean }> {
  let response = NextResponse.next({ request });

  // Supabase 설정 전에도 랜딩 페이지가 떠야 하므로 그대로 통과시킨다.
  if (!hasSupabaseEnv()) {
    return { response, isAuthenticated: false };
  }

  const { url, publishableKey } = getSupabaseEnv();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // 요청에 반영해야 뒤에서 실행되는 서버 컴포넌트가 갱신된 토큰을 읽는다.
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        // 응답에 반영해야 브라우저가 갱신된 토큰을 저장한다.
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        // 세션 쿠키가 담긴 응답이 CDN에 캐시되지 않도록 Supabase가 넘긴 헤더를 붙인다.
        Object.entries(headers).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  // 클라이언트 생성과 getClaims() 사이에 다른 로직을 넣지 않는다.
  // getClaims()가 토큰을 검증·갱신하며, 빠지면 사용자가 임의로 로그아웃될 수 있다.
  const { data } = await supabase.auth.getClaims();

  // 갱신된 쿠키가 담긴 response를 그대로 돌려줘야 한다.
  return { response, isAuthenticated: Boolean(data?.claims) };
}
