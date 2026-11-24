import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingMarkets } from "@/components/landing/LandingMarkets";
import { LandingMarquee } from "@/components/landing/LandingMarquee";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingSpotlight } from "@/components/landing/LandingSpotlight";
import { SmoothScroll } from "@/components/landing/SmoothScroll";

export default function LandingPage() {
  return (
    <>
      <SmoothScroll />
      <LandingNav />
      <main id="content">
        <LandingHero />
        <LandingSpotlight />
        <LandingMarkets />
        <LandingMarquee />
      </main>
      <LandingFooter />
    </>
  );
}
