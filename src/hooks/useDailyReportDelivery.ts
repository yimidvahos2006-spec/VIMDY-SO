import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../presentation/context/AuthContext";
import { getCurrentBranchId } from "../infrastructure/supabase/supabaseClient";
import { dailyReportDeliveryService } from "../infrastructure/supabase/dailyReportDeliveryService";
import type { DailyReportJobSummary } from "../core/dashboard/reports/DailyReportTypes";

export function useDailyReportDelivery() {
  const { businessId } = useAuth();
  const [job, setJob] = useState<DailyReportJobSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) {
      setJob(null);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const next = await dailyReportDeliveryService.getLatest(businessId, getCurrentBranchId());
      setJob(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo consultar el estado del reporte.");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
    if (!businessId) return;
    return dailyReportDeliveryService.subscribe(businessId, () => { void load(); });
  }, [businessId, load]);

  return { job, loading, error, refresh: load };
}
