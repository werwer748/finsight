"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { toAuthErrorMessage } from "@/lib/auth/errors";
import {
  validateEmail,
  validatePassword,
  validatePasswordConfirm,
} from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";
import type { AuthFormState } from "@/types/auth";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signUp(
  prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = field(formData, "email");
  const password = field(formData, "password");

  const errors = {
    email: validateEmail(email) ?? undefined,
    password: validatePassword(password) ?? undefined,
    passwordConfirm:
      validatePasswordConfirm(password, field(formData, "passwordConfirm")) ??
      undefined,
  };
  if (errors.email || errors.password || errors.passwordConfirm) {
    return { errors };
  }

  const origin = (await headers()).get("origin");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });

  if (error) {
    return { message: toAuthErrorMessage(error) };
  }

  // 이메일 확인이 꺼진 프로젝트는 가입과 동시에 세션을 준다.
  if (data.session) {
    redirect("/dashboard");
  }

  // 이미 가입된 이메일이어도 Supabase는 오류 없이 응답한다. 같은 안내를 보여줘 가입 여부를 노출하지 않는다.
  return {
    success: true,
    message: "확인 메일을 보냈어요. 메일의 링크를 눌러 가입을 마쳐 주세요.",
  };
}

export async function signIn(
  prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = field(formData, "email");
  const password = field(formData, "password");

  const errors = {
    email: validateEmail(email) ?? undefined,
    password: validatePassword(password) ?? undefined,
  };
  if (errors.email || errors.password) {
    return { errors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { message: toAuthErrorMessage(error) };
  }

  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
