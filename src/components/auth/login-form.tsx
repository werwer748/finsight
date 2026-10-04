"use client";

import { useActionState, useState } from "react";
import type { JSX } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn } from "@/lib/auth/actions";
import type { AuthFormState } from "@/types/auth";

const initialState: AuthFormState = {};

const CONFIRM_FAILED_NOTICE =
  "이메일 확인을 마치지 못했어요. 로그인해서 다시 시도해 주세요.";

export function LoginForm({ notice }: { notice?: string }): JSX.Element {
  const [state, formAction, isPending] = useActionState(signIn, initialState);
  // React는 액션이 끝나면 비제어 입력을 비운다. 이메일은 다시 치지 않도록 상태로 잡아 둔다.
  const [email, setEmail] = useState("");
  const message =
    state.message ??
    (notice === "confirm-failed" ? CONFIRM_FAILED_NOTICE : undefined);

  return (
    <div className="flex flex-col gap-6">
      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}
      {/* noValidate: 브라우저 기본 말풍선 대신 서버 액션이 돌려준 한국어 오류를 보여준다 */}
      <form action={formAction} noValidate className="flex flex-col gap-4">
        <Input
          label="이메일"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={state.errors?.email}
        />
        <Input
          label="비밀번호"
          name="password"
          type="password"
          autoComplete="current-password"
          error={state.errors?.password}
        />
        <Button type="submit" fullWidth disabled={isPending} className="mt-2">
          로그인
        </Button>
      </form>
      <p className="text-center text-sm text-muted">
        아직 계정이 없나요?{" "}
        <Link
          href="/signup"
          className="font-medium text-primary hover:text-primary-hover"
        >
          회원가입
        </Link>
      </p>
    </div>
  );
}
