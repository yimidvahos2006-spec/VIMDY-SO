import React, { useEffect, useState } from "react";
import { LogOut, User } from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { getBranches, getCurrentBranchId, setCurrentBranchId } from "../../../infrastructure/supabase/supabaseClient";

export function UserSessionBadge() {
  const { user, role, logout, businessId } = useAuth();
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  const currentBranchId = getCurrentBranchId();
  const currentBranch = branches.find((b) => b.id === currentBranchId);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!businessId) return;
      setLoadingBranches(true);
      try {
        const all = await getBranches(businessId);
        if (!cancelled) setBranches(all);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoadingBranches(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  if (!user) return null;

  const hasMultiple = branches.length > 1;

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
          {currentBranch && (
            <p className="text-[11px] text-slate-400">
              Sucursal: {currentBranch.name}
            </p>
          )}
        </div>
      </div>

      {hasMultiple && !loadingBranches && (
        <select
          value={currentBranchId ?? ""}
          onChange={(e) => setCurrentBranchId(e.target.value || null)}
          className="h-8 rounded-lg bg-slate-800 border border-slate-700 px-2 text-xs text-white outline-none focus:border-cyan-500"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      )}

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