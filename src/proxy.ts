import { NextResponse, type NextRequest } from "next/server";
import { resolveAuthRedirect } from "@/lib/auth/routes";
import { updateSession } from "@/lib/supabase/update-session";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { response, isAuthenticated } = await updateSession(request);

  const redirectPath = resolveAuthRedirect(
    request.nextUrl.pathname,
    isAuthenticated,
  );
  if (!redirectPath) {
    return response;
  }

  const redirectResponse = NextResponse.redirect(
    new URL(redirectPath, request.url),
  );
  // 갱신된 세션 쿠키를 옮기지 않으면 브라우저에 저장되지 않아 사용자가 로그아웃된다.
  response.cookies
    .getAll()
    .forEach((cookie) => redirectResponse.cookies.set(cookie));
  // 세션 쿠키가 담긴 리다이렉트가 CDN에 캐시되지 않도록 Supabase가 붙인 캐시 방지 헤더도 옮긴다.
  ["Cache-Control", "Expires", "Pragma"].forEach((name) => {
    const value = response.headers.get(name);
    if (value !== null) {
      redirectResponse.headers.set(name, value);
    }
  });
  return redirectResponse;
}

export const config = {
  matcher: [
    // 정적 파일(_next/static, _next/image, favicon.ico, 이미지 확장자)을 뺀 모든 경로.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
