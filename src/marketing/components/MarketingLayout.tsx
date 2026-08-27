import { Outlet } from "react-router-dom";
import { VimdyAmbientBackground } from "../animations/VimdyAmbientBackground";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";

export function MarketingLayout() {
  return (
    <div className="min-h-screen text-white relative">
      <VimdyAmbientBackground />
      <div className="relative z-10">
        <Navbar />
        <main>
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  );
}
