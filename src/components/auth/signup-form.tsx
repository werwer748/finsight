"use client";

import { useActionState, useEffect, useState } from "react";
import type { JSX } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signUp } from "@/lib/auth/actions";
import type { AuthFormState } from "@/types/auth";

const initialState: AuthFormState = {};
const isPostHogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN &&
    process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

export function SignupForm(): JSX.Element {
  const [state, formAction, isPending] = useActionState(signUp, initialState);
  // React는 액션이 끝나면 비제어 입력을 비운다. 이메일은 다시 치지 않도록 상태로 잡아 둔다.
  const [email, setEmail] = useState("");

  // 액션은 끝날 때마다 새 state 객체를 돌려주므로 제출 한 번에 한 번만 실행된다.
  // cacheComponents를 켜면 화면이 다시 보일 때 effect가 또 돌아 마지막 결과를 한 번 더 보내니 그때 다시 본다.
  useEffect(() => {
    if (!isPostHogConfigured) {
      return;
    }

    // 이미 가입된 이메일에도 같은 state가 오므로 메일을 보냈다고 하지 않고 요청을 받았다고만 한다.
    if (state.success) {
      posthog.capture("signup_accepted");
    } else if (state.errors) {
      posthog.capture("signup_failed", { reason: "validation" });
    } else if (state.message) {
      posthog.capture("signup_failed", { reason: "server" });
    }
  }, [state]);

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
          <form
            action={formAction}
            noValidate
            className="flex flex-col gap-4"
            onSubmit={() => {
              if (isPostHogConfigured) {
                posthog.capture("signup_submitted");
              }
            }}
          >
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
