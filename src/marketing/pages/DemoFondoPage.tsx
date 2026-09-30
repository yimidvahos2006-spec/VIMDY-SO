import { VimdyAmbientBackground } from "../animations/VimdyAmbientBackground";
import { VimdyLogo } from "../../presentation/components/ui/VimdyLogo";

export function DemoFondoPage() {
  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#05070a]">
      <VimdyAmbientBackground
        variant="live"
        liveTiming={{ cycleMs: 2000, formMs: 800, holdMs: 600, dissolveMs: 600 }}
      />

      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-6 text-center">
        <VimdyLogo size={120} />

        <h1 className="text-4xl font-extrabold tracking-tighter text-zinc-300">
          VIMDY OS
        </h1>

        <p className="max-w-md text-zinc-400">
          Fondo animado con partículas que se re-forman en V, platos, cafeteras y más cada 2 segundos.
        </p>
      </div>
    </div>
  );
}
