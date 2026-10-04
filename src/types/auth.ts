export type AuthFormState = {
  success?: boolean;
  message?: string; // 폼 전체에 대한 안내 또는 오류
  errors?: { email?: string; password?: string; passwordConfirm?: string };
};
