import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { Card } from "@/components/ui/card";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { notice } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center bg-surface px-4 py-12">
      <Card className="w-full max-w-sm">
        <Link href="/" className="text-lg font-bold tracking-tight">
          FinSight
        </Link>
        <h1 className="mt-6 mb-6 text-2xl font-bold tracking-tight">로그인</h1>
        <LoginForm notice={typeof notice === "string" ? notice : undefined} />
      </Card>
    </main>
  );
}
