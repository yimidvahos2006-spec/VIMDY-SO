import React, { useState } from "react";
import { ClipboardList, History } from "lucide-react";

import { KitchenDashboard } from "../components/dashboard/kitchen/KitchenDashboard";
import { KitchenHistoryPanel } from "../components/dashboard/kitchen/KitchenHistoryPanel";

type KitchenTab = "activos" | "historial";

export const KitchenPage: React.FC = () => {
  const [tab, setTab] = useState<KitchenTab>("activos");

  return (
    <div className="min-h-screen p-8">
      <div className="flex gap-2 mb-8">
        <TabButton
          active={tab === "activos"}
          onClick={() => setTab("activos")}
          icon={ClipboardList}
          label="Comandas activas"
        />
        <TabButton
          active={tab === "historial"}
          onClick={() => setTab("historial")}
          icon={History}
          label="Historial de entregados"
        />
      </div>

      {tab === "activos" ? <KitchenDashboard /> : <KitchenHistoryPanel />}
    </div>
  );

};

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}

function TabButton({ active, onClick, icon: Icon, label }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm transition-colors ${
        active
          ? "bg-vimdy-accent text-white"
          : "bg-vimdy-surface text-vimdy-text-secondary border border-vimdy-border hover:text-vimdy-text"
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}