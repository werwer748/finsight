import { LandingFooter } from "@/components/landing/footer";
import { LandingHeader } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";

export default function Home() {
  return (
    <>
      <LandingHeader />
      <main className="flex-1">
        <Hero />
      </main>
      <LandingFooter />
    </>
  );
}
