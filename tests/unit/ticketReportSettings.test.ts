import { describe, it, expect, vi, beforeEach } from "vitest";

type DbResult = { data: unknown; error: { message: string; code?: string } | null };

const state: { rpc: DbResult; query: DbResult } = {
  rpc: { data: null, error: null },
  query: { data: null, error: null }
};
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const queryOps: Array<{ table: string; ops: Array<[string, ...unknown[]]> }> = [];

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return state.rpc;
    },
    from: (table: string) => {
      const record = { table, ops: [] as Array<[string, ...unknown[]]> };
      queryOps.push(record);
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "order", "delete"]) {
        builder[op] = (...args: unknown[]) => {
          record.ops.push([op, ...args]);
          return builder;
        };
      }
      builder.maybeSingle = async () => {
        record.ops.push(["maybeSingle"]);
        return state.query;
      };
      builder.then = (resolve: (value: DbResult) => unknown) => resolve(state.query);
      return builder;
    }
  }
}));

import {
  fetchEffectiveTicketPrintSettings,
  fetchTicketPrintSettingsScope,
  listTicketPrintSettingsScopes,
  saveTicketPrintSettings,
  clearBranchTicketPrintSettings
} from "../../src/infrastructure/supabase/ticketPrintSettingsRepository";
import {
  fetchEffectiveReportCloseSettings,
  saveReportCloseSettings,
  clearBranchReportCloseSettings
} from "../../src/infrastructure/supabase/reportCloseSettingsRepository";
import {
  defaultReportCloseSettings,
  defaultTicketPrintSettings,
  normalizeReportEmails,
  reportCloseSettingsToPayload,
  ticketPrintSettingsToPayload,
  validateReportCloseSettings,
  validateTicketPrintSettings
} from "../../src/core/settings/ticketReportSettings";

const BIZ = "11111111-1111-4111-8111-111111111111";
const BR = "22222222-2222-4222-8222-222222222222";

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    business_id: BIZ,
    branch_id: null,
    template: "restaurante",
    paper_width: "58mm",
    accent_color: "green",
    show_logo: false,
    show_qr: true,
    show_address: true,
    show_phone: true,
    show_email: true,
    show_cashier: true,
    show_customer: false,
    show_tax: true,
    show_discount: true,
    footer_message: "Gracias",
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T11:00:00Z",
    updated_by: null,
    ...overrides
  };
}

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-2",
    business_id: BIZ,
    branch_id: null,
    enabled: true,
    send_on_shift_close: true,
    email_enabled: true,
    email_recipients: ["dueno@negocio.co"],
    email_fallback_enabled: false,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T11:00:00Z",
    updated_by: null,
    ...overrides
  };
}

beforeEach(() => {
  state.rpc = { data: null, error: null };
  state.query = { data: null, error: null };
  rpcCalls.length = 0;
  queryOps.length = 0;
});

describe("validación del ticket", () => {
  it("acepta los defaults y normaliza saltos de línea de Windows", () => {
    const defaults = defaultTicketPrintSettings();
    expect(validateTicketPrintSettings(defaults)).toEqual(defaults);
    expect(validateTicketPrintSettings({ ...defaults, footerMessage: "a\r\nb" }).footerMessage).toBe("a\nb");
  });

  it("rechaza valores fuera de catálogo y un pie demasiado largo (sin recortar)", () => {
    const d = defaultTicketPrintSettings();
    expect(() => validateTicketPrintSettings({ ...d, template: "inventada" as never })).toThrow(/TICKET_SETTINGS_INVALID/);
    expect(() => validateTicketPrintSettings({ ...d, paperWidth: "100mm" as never })).toThrow(/ancho de papel/);
    expect(() => validateTicketPrintSettings({ ...d, accentColor: "morado" as never })).toThrow(/color/);
    expect(() => validateTicketPrintSettings({ ...d, footerMessage: "x".repeat(241) })).toThrow(/240/);
    expect(() => validateTicketPrintSettings({ ...d, showQr: "si" as never })).toThrow(/showQr/);
  });

  it("convierte a snake_case para la base", () => {
    const payload = ticketPrintSettingsToPayload({ ...defaultTicketPrintSettings(), paperWidth: "58mm", showTax: false });
    expect(payload.paper_width).toBe("58mm");
    expect(payload.show_tax).toBe(false);
    // 13 originales + show_table + show_footer (Parte 3)
    expect(Object.keys(payload)).toHaveLength(15);
  });
});

describe("validación del cierre por correo", () => {
  it("normaliza: minúsculas, sin espacios, sin repetidos", () => {
    expect(normalizeReportEmails([" Dueno@Negocio.co ", "dueno@negocio.co", ""])).toEqual(["dueno@negocio.co"]);
  });

  it("rechaza correos inválidos señalando cuál (no los descarta en silencio)", () => {
    const base = defaultReportCloseSettings();
    expect(() => validateReportCloseSettings({ ...base, emailRecipients: ["no-es-correo"] })).toThrow(/no-es-correo/);
    expect(() =>
      validateReportCloseSettings({ ...base, emailRecipients: ["1@a.co", "2@a.co", "3@a.co", "4@a.co", "5@a.co", "6@a.co"] })
    ).toThrow(/hasta 5/);
  });

  it("genera el payload con correos normalizados", () => {
    const payload = reportCloseSettingsToPayload({ ...defaultReportCloseSettings(), emailRecipients: ["A@B.co"] });
    expect(payload.email_recipients).toEqual(["a@b.co"]);
    expect(payload.send_on_shift_close).toBe(true);
  });
});

describe("ticketPrintSettingsRepository", () => {
  it("sin filas guardadas devuelve los defaults con source=default", async () => {
    state.rpc = { data: [], error: null };
    const r = await fetchEffectiveTicketPrintSettings(BIZ, BR);
    expect(r.source).toBe("default");
    expect(r.settings).toEqual(defaultTicketPrintSettings());
    expect(r.updatedAt).toBeNull();
    expect(rpcCalls[0]).toEqual({ fn: "resolve_ticket_print_settings", args: { p_business_id: BIZ, p_branch_id: BR } });
  });

  it("hereda del negocio cuando la fila devuelta es global, y usa el override cuando existe", async () => {
    state.rpc = { data: [ticketRow()], error: null };
    const inherited = await fetchEffectiveTicketPrintSettings(BIZ, BR);
    expect(inherited.source).toBe("business");
    expect(inherited.branchId).toBeNull();
    expect(inherited.settings.template).toBe("restaurante");

    state.rpc = { data: [ticketRow({ branch_id: BR, template: "cafeteria" })], error: null };
    const own = await fetchEffectiveTicketPrintSettings(BIZ, BR);
    expect(own.source).toBe("branch");
    expect(own.branchId).toBe(BR);
    expect(own.settings.template).toBe("cafeteria");
  });

  it("sin sucursal manda p_branch_id null (global)", async () => {
    state.rpc = { data: [], error: null };
    await fetchEffectiveTicketPrintSettings(BIZ);
    await fetchEffectiveTicketPrintSettings(BIZ, "  ");
    expect(rpcCalls.map((c) => c.args.p_branch_id)).toEqual([null, null]);
  });

  it("lanza si falta el negocio o si la base falla (no inventa defaults ante un error)", async () => {
    await expect(fetchEffectiveTicketPrintSettings("  ")).rejects.toThrow(/BUSINESS_CONTEXT_REQUIRED/);
    state.rpc = { data: null, error: { message: "boom" } };
    await expect(fetchEffectiveTicketPrintSettings(BIZ)).rejects.toThrow("boom");
  });

  it("migración sin aplicar: mensaje claro", async () => {
    state.rpc = { data: null, error: { message: "Could not find the function", code: "PGRST202" } };
    await expect(fetchEffectiveTicketPrintSettings(BIZ)).rejects.toThrow(/SETTINGS_SCHEMA_MISSING/);
  });

  it("fetch por alcance: global usa is(null), sucursal usa eq", async () => {
    state.query = { data: null, error: null };
    expect(await fetchTicketPrintSettingsScope(BIZ)).toBeNull();
    state.query = { data: ticketRow({ branch_id: BR }), error: null };
    const scope = await fetchTicketPrintSettingsScope(BIZ, BR);
    expect(scope?.branchId).toBe(BR);
    expect(queryOps[0].ops).toContainEqual(["is", "branch_id", null]);
    expect(queryOps[1].ops).toContainEqual(["eq", "branch_id", BR]);
    expect(queryOps[0].table).toBe("ticket_print_settings");
  });

  it("lista los alcances visibles", async () => {
    state.query = { data: [ticketRow(), ticketRow({ branch_id: BR })], error: null };
    const scopes = await listTicketPrintSettingsScopes(BIZ);
    expect(scopes.map((s) => s.branchId)).toEqual([null, BR]);
  });

  it("guarda por RPC con el payload completo en snake_case", async () => {
    state.rpc = { data: ticketRow({ branch_id: BR, template: "cafeteria" }), error: null };
    const saved = await saveTicketPrintSettings({
      businessId: BIZ,
      branchId: BR,
      settings: { ...defaultTicketPrintSettings(), template: "cafeteria" }
    });
    expect(saved.branchId).toBe(BR);
    expect(rpcCalls[0].fn).toBe("upsert_ticket_print_settings");
    expect(rpcCalls[0].args.p_branch_id).toBe(BR);
    expect((rpcCalls[0].args.p_settings as Record<string, unknown>).template).toBe("cafeteria");
  });

  it("no llama al servidor con datos inválidos", async () => {
    await expect(
      saveTicketPrintSettings({ businessId: BIZ, settings: { ...defaultTicketPrintSettings(), template: "x" as never } })
    ).rejects.toThrow(/TICKET_SETTINGS_INVALID/);
    expect(rpcCalls).toHaveLength(0);
  });

  it("un no-ADMIN (RLS 42501) recibe SETTINGS_FORBIDDEN", async () => {
    state.rpc = { data: null, error: { message: 'new row violates row-level security policy for table "ticket_print_settings"', code: "42501" } };
    await expect(saveTicketPrintSettings({ businessId: BIZ, settings: defaultTicketPrintSettings() })).rejects.toThrow(
      /SETTINGS_FORBIDDEN/
    );
  });

  it("sucursal de otro negocio (FK 23503) y confirmación vacía", async () => {
    state.rpc = { data: null, error: { message: "fk", code: "23503" } };
    await expect(saveTicketPrintSettings({ businessId: BIZ, branchId: BR, settings: defaultTicketPrintSettings() })).rejects.toThrow(
      /SETTINGS_BRANCH_INVALID/
    );
    state.rpc = { data: null, error: null };
    await expect(saveTicketPrintSettings({ businessId: BIZ, settings: defaultTicketPrintSettings() })).rejects.toThrow(
      /SETTINGS_NOT_SAVED/
    );
  });

  it("quitar override: true si borró, false si no había (o la RLS lo ocultó)", async () => {
    state.query = { data: [{ id: "row-1" }], error: null };
    expect(await clearBranchTicketPrintSettings(BIZ, BR)).toBe(true);
    expect(queryOps[0].ops).toContainEqual(["eq", "branch_id", BR]);
    state.query = { data: [], error: null };
    expect(await clearBranchTicketPrintSettings(BIZ, BR)).toBe(false);
    await expect(clearBranchTicketPrintSettings(BIZ, "")).rejects.toThrow(/BRANCH_CONTEXT_REQUIRED/);
  });
});

describe("reportCloseSettingsRepository", () => {
  it("sin filas visibles devuelve defaults", async () => {
    state.rpc = { data: [], error: null };
    const r = await fetchEffectiveReportCloseSettings(BIZ, BR);
    expect(r.source).toBe("default");
    expect(r.settings).toEqual(defaultReportCloseSettings());
    expect(rpcCalls[0].fn).toBe("resolve_report_close_settings");
  });

  it("lee override o global con sus correos", async () => {
    state.rpc = { data: [reportRow({ branch_id: BR, email_recipients: ["sede@negocio.co"] })], error: null };
    const r = await fetchEffectiveReportCloseSettings(BIZ, BR);
    expect(r.source).toBe("branch");
    expect(r.settings.emailRecipients).toEqual(["sede@negocio.co"]);
    expect(r.settings.emailFallbackEnabled).toBe(false);
  });

  it("guarda normalizando correos y rechaza uno inválido sin ir al servidor", async () => {
    state.rpc = { data: reportRow(), error: null };
    await saveReportCloseSettings({
      businessId: BIZ,
      settings: { ...defaultReportCloseSettings(), emailRecipients: [" Dueno@Negocio.co "] }
    });
    expect(rpcCalls[0].fn).toBe("upsert_report_close_settings");
    expect(rpcCalls[0].args.p_branch_id).toBeNull();
    expect((rpcCalls[0].args.p_settings as { email_recipients: string[] }).email_recipients).toEqual(["dueno@negocio.co"]);

    rpcCalls.length = 0;
    await expect(
      saveReportCloseSettings({ businessId: BIZ, settings: { ...defaultReportCloseSettings(), emailRecipients: ["malo"] } })
    ).rejects.toThrow(/REPORT_SETTINGS_INVALID/);
    expect(rpcCalls).toHaveLength(0);
  });

  it("un no-ADMIN recibe SETTINGS_FORBIDDEN al guardar", async () => {
    state.rpc = { data: null, error: { message: "new row violates row-level security policy", code: "42501" } };
    await expect(saveReportCloseSettings({ businessId: BIZ, settings: defaultReportCloseSettings() })).rejects.toThrow(
      /SETTINGS_FORBIDDEN/
    );
  });

  it("quitar override devuelve boolean", async () => {
    state.query = { data: [{ id: "x" }], error: null };
    expect(await clearBranchReportCloseSettings(BIZ, BR)).toBe(true);
    expect(queryOps[0].table).toBe("report_close_settings");
    state.query = { data: [], error: null };
    expect(await clearBranchReportCloseSettings(BIZ, BR)).toBe(false);
  });
});