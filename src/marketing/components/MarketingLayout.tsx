import { Outlet } from "react-router-dom";
import { VimdyWaveBackground } from "../animations/VimdyWaveBackground";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";

export function MarketingLayout() {
  return (
    <div className="relative isolate min-h-screen overflow-x-clip bg-[#05070a] text-white">
      <a
        href="#main-content"
        className="sr-only z-[100] rounded-md bg-white px-4 py-2 text-sm font-semibold text-black focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:outline-none focus:ring-2 focus:ring-cyan-300/60"
      >
        Ir al contenido principal
      </a>

      <VimdyWaveBackground />

      <div className="relative z-10 min-h-screen">
        <Navbar />

        <main
          id="main-content"
          tabIndex={-1}
          className="relative min-h-screen outline-none"
        >
          <Outlet />
        </main>

        <Footer />
      </div>
    </div>
  );
}