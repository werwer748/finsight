import { createClient } from "@/lib/supabase/server";

export type CurrentUser = { id: string; email: string };

// 로그인하지 않았으면 null.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  // getClaims()는 토큰 서명을 검증한다. 쿠키 값을 검증 없이 믿는 세션 조회는 쓰지 않는다.
  const { data } = await supabase.auth.getClaims();

  const claims = data?.claims;
  if (!claims) {
    return null;
  }

  // 이메일 가입만 받으므로 email은 항상 있다. 타입상 선택 값이라 빈 문자열로 채운다.
  return { id: claims.sub, email: claims.email ?? "" };
}
