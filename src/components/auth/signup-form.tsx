"use client";

import { useActionState, useState } from "react";
import type { JSX } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signUp } from "@/lib/auth/actions";
import type { AuthFormState } from "@/types/auth";

const initialState: AuthFormState = {};

export function SignupForm(): JSX.Element {
  const [state, formAction, isPending] = useActionState(signUp, initialState);
  // React는 액션이 끝나면 비제어 입력을 비운다. 이메일은 다시 치지 않도록 상태로 잡아 둔다.
  const [email, setEmail] = useState("");

  return (
    <div className="flex flex-col gap-6">
      {state.success ? (
        <p role="status" className="text-base break-keep text-foreground">
          {state.message}
        </p>
      ) : (
        <>
          {state.message && (
            <p role="alert" className="text-sm text-danger">
              {state.message}
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
              autoComplete="new-password"
              placeholder="8자 이상"
              error={state.errors?.password}
            />
            <Input
              label="비밀번호 확인"
              name="passwordConfirm"
              type="password"
              autoComplete="new-password"
              error={state.errors?.passwordConfirm}
            />
            <Button
              type="submit"
              fullWidth
              disabled={isPending}
              className="mt-2"
            >
              가입하기
            </Button>
          </form>
        </>
      )}
      <p className="text-center text-sm text-muted">
        이미 계정이 있나요?{" "}
        <Link
          href="/login"
          className="font-medium text-primary hover:text-primary-hover"
        >
          로그인
        </Link>
      </p>
    </div>
  );
}
