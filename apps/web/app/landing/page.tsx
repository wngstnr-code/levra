import { LandingHero } from "@/components/landing/LandingHero";
import { LandingNav } from "@/components/landing/LandingNav";

export default function LandingPage() {
  return (
    <>
      <LandingNav />
      <main id="content">
        <LandingHero />
      </main>
    </>
  );
}
