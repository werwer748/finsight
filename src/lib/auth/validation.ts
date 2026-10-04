// 문제가 없으면 null, 있으면 한국어 오류 문구를 돌려준다.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export function validateEmail(email: string): string | null {
  if (!email) return "이메일을 입력해 주세요.";
  if (!EMAIL_PATTERN.test(email)) return "이메일 형식이 올바르지 않아요.";
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return "비밀번호를 입력해 주세요.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 해요.`;
  }
  return null;
}

export function validatePasswordConfirm(
  password: string,
  confirm: string,
): string | null {
  if (!confirm) return "비밀번호를 한 번 더 입력해 주세요.";
  if (password !== confirm) return "비밀번호가 일치하지 않아요.";
  return null;
}
