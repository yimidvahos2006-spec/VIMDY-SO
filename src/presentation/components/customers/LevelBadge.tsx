import React from "react";
import { Crown, Award, Medal } from "lucide-react";

import { getLoyaltyInfo } from "../../../core/store/useCustomers";

export const LEVEL_ICON: Record<string, React.ElementType> = {
  oro: Crown,
  plata: Award,
  bronce: Medal
};

const LEVEL_CLASS: Record<string, string> = {
  oro: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  plata: "text-slate-300 bg-slate-400/10 border-slate-400/30",
  bronce: "text-orange-400 bg-orange-500/10 border-orange-500/30"
};

export function LevelBadge({ points }: { points: number }) {
  const level = getLoyaltyInfo(points);
  const Icon = LEVEL_ICON[level.level];
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${LEVEL_CLASS[level.level]}`}
    >
      <Icon size={11} />
      {level.label}
    </span>
  );
}