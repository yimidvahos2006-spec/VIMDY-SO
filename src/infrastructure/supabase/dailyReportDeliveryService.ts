import { getCurrentBranchId, getCurrentBusinessId, supabase } from "./supabaseClient";
import type { DailyReportDeliveryRecord, DailyReportJobSummary } from "../../core/dashboard/reports/DailyReportTypes";

interface JobRow {
  id: string;
  business_id: string;
  branch_id: string;
  shift_id: string;
  status: DailyReportJobSummary["status"];
  business_date: string;
  opened_at: string;
  closed_at: string;
  report_text: string | null;
  snapshot: DailyReportJobSummary["snapshot"];
  attempts: number;
  last_error: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface DeliveryRow {
  id: string;
  job_id: string;
  channel: DailyReportDeliveryRecord["channel"];
  recipient: string;
  status: DailyReportDeliveryRecord["status"];
  attempts: number;
  provider_message_id: string | null;
  last_error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  updated_at: string;
}

function mapDelivery(row: DeliveryRow): DailyReportDeliveryRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    channel: row.channel,
    recipient: row.recipient,
    status: row.status,
    attempts: row.attempts,
    providerMessageId: row.provider_message_id,
    lastError: row.last_error,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    updatedAt: row.updated_at,
  };
}

function mapJob(row: JobRow, deliveries: DeliveryRow[]): DailyReportJobSummary {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    shiftId: row.shift_id,
    status: row.status,
    businessDate: row.business_date,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    reportText: row.report_text,
    snapshot: row.snapshot,
    attempts: row.attempts,
    lastError: row.last_error,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
    deliveries: deliveries.map(mapDelivery),
  };
}

export const dailyReportDeliveryService = {
  async kick(input: { businessId?: string; branchId?: string; shiftId?: string } = {}): Promise<void> {
    const businessId = input.businessId ?? getCurrentBusinessId();
    if (!businessId) return;

    const { error } = await supabase.functions.invoke("process-daily-report", {
      body: {
        businessId,
        branchId: input.branchId ?? getCurrentBranchId() ?? null,
        shiftId: input.shiftId ?? null,
        limit: 5,
      },
    });

    // El cierre de caja NO depende de esta llamada. El job durable ya quedó
    // creado dentro de la transacción de cierre; esta llamada solo acelera su
    // procesamiento cuando hay conexión. Si falla, el backstop del servidor
    // lo procesará después.
    if (error) {
      console.warn("[DailyReport] No se pudo activar el procesador inmediato:", error.message);
    }
  },

  async getLatest(businessId?: string, branchId?: string): Promise<DailyReportJobSummary | null> {
    const resolvedBusinessId = businessId ?? getCurrentBusinessId();
    if (!resolvedBusinessId) return null;

    let query = supabase
      .from("daily_report_jobs")
      .select("id,business_id,branch_id,shift_id,status,business_date,opened_at,closed_at,report_text,snapshot,attempts,last_error,completed_at,updated_at")
      .eq("business_id", resolvedBusinessId)
      .order("closed_at", { ascending: false })
      .limit(1);

    if (branchId ?? getCurrentBranchId()) {
      query = query.eq("branch_id", branchId ?? getCurrentBranchId()!);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`DAILY_REPORT_JOB_READ_FAILED: ${error.message}`);
    if (!data) return null;

    const row = data as JobRow;
    const { data: deliveries, error: deliveryError } = await supabase
      .from("daily_report_deliveries")
      .select("id,job_id,channel,recipient,status,attempts,provider_message_id,last_error,sent_at,delivered_at,read_at,updated_at")
      .eq("job_id", row.id)
      .order("created_at", { ascending: true });

    if (deliveryError) throw new Error(`DAILY_REPORT_DELIVERY_READ_FAILED: ${deliveryError.message}`);
    return mapJob(row, (deliveries ?? []) as DeliveryRow[]);
  },

  subscribe(businessId: string, onChange: () => void): () => void {
    const channel = supabase
      .channel(`daily-report-jobs:${businessId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "daily_report_jobs",
          filter: `business_id=eq.${businessId}`,
        },
        onChange,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  },
};
