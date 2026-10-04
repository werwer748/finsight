import type { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/update-session";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { response } = await updateSession(request);
  return response;
}

export const config = {
  matcher: [
    // 정적 파일(_next/static, _next/image, favicon.ico, 이미지 확장자)을 뺀 모든 경로.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
