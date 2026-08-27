import React, { lazy, Suspense } from "react";
import { Menu } from "lucide-react";

import { VimdyAmbientBackground } from "../../marketing/animations/VimdyAmbientBackground";
import { VimdySidebar } from "../components/ui/VimdySidebar";
import { VimdyLogo } from "../components/ui/VimdyLogo";
import { useSidebar } from "../../core/store/useSidebar";
import { useMobileSidebar } from "../../core/store/useMobileSidebar";
import { useAutoAlerts } from "../../hooks/useAutoAlerts";
import { useDashboardSync } from "../../hooks/useDashboardSync";
import { companyConfigStore } from "../../core/store/companyConfigStore";

const NotificationBell = lazy(() =>
  import("../components/ui/NotificationBell").then((m) => ({ default: m.NotificationBell }))
);
const CopilotPanel = lazy(() =>
  import("../components/copilot/CopilotPanel").then((m) => ({ default: m.CopilotPanel }))
);
const CopilotButton = lazy(() =>
  import("../components/copilot/CopilotButton").then((m) => ({ default: m.CopilotButton }))
);
const SubscriptionWarningBanner = lazy(() =>
  import("../components/subscription/SubscriptionWarningBanner").then((m) => ({ default: m.SubscriptionWarningBanner }))
);
const TrialEndedOverlay = lazy(() =>
  import("../components/subscription/TrialEndedOverlay").then((m) => ({ default: m.TrialEndedOverlay }))
);
const MobileBottomNav = lazy(() =>
  import("../components/ui/MobileBottomNav").then((m) => ({ default: m.MobileBottomNav }))
);

function LazySection({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-40">
          <div className="w-8 h-8 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

interface Props {
  children: React.ReactNode;
}

export function VimdyAppLayout({ children }: Props) {

  const { expanded } = useSidebar();
  const { show: openMobileSidebar } = useMobileSidebar();

  useAutoAlerts();
  useDashboardSync();

  return (
    <div className="min-h-screen relative">
      <VimdyAmbientBackground className="opacity-40" />
      <div className="relative z-10">
        {companyConfigStore.get().enableAI && (
          <LazySection>
            <NotificationBell />
          </LazySection>
        )}

        <VimdySidebar />

        <div className="h-screen overflow-hidden">

          <div className="md:hidden h-16 flex items-center gap-3 px-4 border-b border-vimdy-border bg-vimdy-background">
            <button
              onClick={openMobileSidebar}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-vimdy-text-secondary hover:bg-vimdy-surface hover:text-vimdy-text transition-all flex-shrink-0"
            >
              <Menu size={22} />
            </button>
            <VimdyLogo size={28} />
            <span className="text-vimdy-text font-semibold tracking-wide">VIMDY</span>
          </div>

          <main
            className={`
              ml-0
              ${expanded ? "md:ml-[260px]" : "md:ml-[84px]"}
              h-[calc(100vh-4rem)]
              md:h-screen
              overflow-y-auto
              overflow-x-hidden
              transition-all
              duration-300
              pb-16 md:pb-0
            `}
          >
            {children}
          </main>

          <LazySection>
            <MobileBottomNav />
          </LazySection>

        </div>

        {companyConfigStore.get().enableAI && (
          <LazySection>
            <>
              <CopilotPanel />
              <CopilotButton />
            </>
          </LazySection>
        )}

        <LazySection>
          <SubscriptionWarningBanner />
          <TrialEndedOverlay />
        </LazySection>
      </div>
    </div>
  );
}

export default VimdyAppLayout;