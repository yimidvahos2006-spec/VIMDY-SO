import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// El Edge Function (Deno) no se puede ejecutar bajo vitest. Estas comprobaciones
// de contrato evitan que el cableado con la lógica probada se rompa en silencio.
const source = readFileSync(resolve(__dirname, "../../supabase/functions/process-daily-report/index.ts"), "utf8");

describe("process-daily-report usa la lógica de cierre por correo", () => {
  it("importa los módulos compartidos probados", () => {
    expect(source).toContain('from "../_shared/reportCloseEmail.ts"');
    expect(source).toContain('from "../_shared/reportCloseDelivery.ts"');
  });

  it("lee la configuración nueva por el RPC con herencia y cae al sistema anterior", () => {
    expect(source).toContain('rpc("resolve_report_close_settings"');
    expect(source).toContain('from("daily_report_settings")');
    expect(source).toContain("isMissingSchemaError(error)");
    expect(source).toContain("getSettings(job.business_id, job.branch_id)");
  });

  it("resuelve destinatarios con respaldo ADMIN/GERENTE en el cierre y en el respaldo de WhatsApp", () => {
    expect(source.match(/resolveEmailRecipients\(/g)?.length).toBe(2);
    expect(source).toContain("pickFallbackEmails(candidates)");
  });

  it("cada entrega por correo lleva Idempotency-Key", () => {
    expect(source).toContain("`daily-report-delivery/${delivery.id}`");
  });

  it("la acción TEST_EMAIL pasa por handleTestEmail con el rol verificado en el servidor", () => {
    expect(source).toContain("handleTestEmail(");
    expect(source).toContain("role: auth.role");
    expect(source).not.toContain('error: "INVALID_EMAIL"');
  });

  it("no quedó el envío directo a Resend ni la lectura antigua de ADMIN/GERENTE sin filtrar activos", () => {
    expect(source).not.toContain('fetch("https://api.resend.com/emails"');
    expect(source).not.toContain("settings.email_recipients");
    expect(source).not.toContain("settings.whatsapp_enabled");
  });
});