import { Hero } from "../components/Hero";
import { TrustBar } from "../components/TrustBar";
import { ModuleConnections } from "../components/ModuleConnections";
import { BusinessTypes } from "../components/BusinessTypes";
import { HowItWorks } from "../components/HowItWorks";
import { Pricing } from "../components/Pricing";
import { FAQ } from "../components/FAQ";
import { FinalCTA } from "../components/FinalCTA";
import { VimdyAssistant } from "../components/VimdyAssistant";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#050505]">
      <main>
        <Hero />
        <TrustBar />
        <ModuleConnections />
        <BusinessTypes />
        <HowItWorks />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <VimdyAssistant />
    </div>
  );
}
