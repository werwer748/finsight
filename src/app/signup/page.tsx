import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";
import { Card } from "@/components/ui/card";

export default function SignupPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-surface px-4 py-12">
      <Card className="w-full max-w-sm">
        <Link href="/" className="text-lg font-bold tracking-tight">
          FinSight
        </Link>
        <h1 className="mt-6 mb-6 text-2xl font-bold tracking-tight">회원가입</h1>
        <SignupForm />
      </Card>
    </main>
  );
}
