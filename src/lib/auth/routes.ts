// 리다이렉트할 경로를 돌려준다. 그대로 두면 null.
export function resolveAuthRedirect(
  pathname: string,
  isAuthenticated: boolean,
): string | null {
  const isProtected =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  if (isProtected && !isAuthenticated) {
    return "/login";
  }

  const isGuestOnly = pathname === "/login" || pathname === "/signup";
  if (isGuestOnly && isAuthenticated) {
    return "/dashboard";
  }

  return null;
}
