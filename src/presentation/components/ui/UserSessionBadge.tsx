import React from "react";
import { LogOut, User } from "lucide-react";

import { useAuth } from "../../context/AuthContext";

export function UserSessionBadge() {
  const { user, role, logout } = useAuth();

  if (!user) return null;

  return (
    <div
      className="
        fixed top-4 right-6 z-50
        flex items-center gap-3
        rounded-2xl border border-slate-800
        bg-slate-900/90 backdrop-blur-xl
        px-4 py-2
        shadow-xl
      "
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300">
          <User size={16} />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">{user.name}</p>
          <p className="text-xs text-cyan-200/60">{role?.name}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => logout()}
        title="Cerrar sesión"
        className="
          flex h-8 w-8 items-center justify-center rounded-xl
          text-slate-400 hover:text-red-400 hover:bg-red-500/10
          transition-colors
        "
      >
        <LogOut size={16} />
      </button>
    </div>
  );
}