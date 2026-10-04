import type { JSX } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";

export function Hero(): JSX.Element {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-20 text-center sm:px-6 sm:py-32">
      {/* break-keep: 한국어가 단어 중간에서 줄바꿈되지 않게 한다 */}
      <h1 className="text-4xl leading-tight font-bold tracking-tight break-keep sm:text-5xl">
        거래 내역 파일만 올리면, 소비가 한눈에
      </h1>
      <p className="mt-6 max-w-xl text-lg break-keep text-muted">
        은행·카드사에서 내려받은 CSV, Excel 파일을 올리면 자동으로 분류해
        대시보드로 보여드려요.
      </p>
      <ButtonLink href="/signup" size="lg" className="mt-10">
        무료로 시작하기
      </ButtonLink>
      <p className="mt-4 text-sm text-muted">
        이미 계정이 있나요?{" "}
        <Link
          href="/login"
          className="font-medium text-primary hover:text-primary-hover"
        >
          로그인
        </Link>
      </p>
    </section>
  );
}
