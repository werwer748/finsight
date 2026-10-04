// Supabase 인증 오류를 한국어 문구로 바꾼다. Supabase의 영어 message는 화면에 내보내지 않는다.
export function toAuthErrorMessage(error: {
  code?: string;
  message?: string;
}): string {
  switch (error.code) {
    case "invalid_credentials":
      return "이메일 또는 비밀번호가 올바르지 않아요.";
    case "email_not_confirmed":
      return "이메일 확인이 필요해요. 받은 메일의 링크를 눌러 주세요.";
    case "user_already_exists":
    case "email_exists":
      return "이미 가입된 이메일이에요.";
    case "weak_password":
      return "비밀번호는 8자 이상이어야 해요.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";
    default:
      return "문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
  }
}
