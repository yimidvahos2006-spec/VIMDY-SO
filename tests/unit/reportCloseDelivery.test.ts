import { describe, it, expect } from "vitest";
import {
  handleTestEmail,
  hasEntries,
  isMissingSchemaError,
  loadCloseSettings,
  mergeCloseSettings,
  normalizeEmailList,
  pickFallbackEmails,
  resolveEmailRecipients,
  type CloseSettings,
  type CloseSettingsStore,
  type LegacyDailyReportSettingsRow,
  type MemberCandidate,
  type ReportCloseSettingsRow,
  type TestEmailDeps
} from "../../supabase/functions/_shared/reportCloseDelivery";
import { EmailSendError } from "../../supabase/functions/_shared/reportCloseEmail";

const BIZ = "11111111-1111-4111-8111-111111111111";
const BR = "22222222-2222-4222-8222-222222222222";

function freshRow(overrides: Partial<ReportCloseSettingsRow> = {}): ReportCloseSettingsRow {
  return {
    branch_id: null,
    enabled: true,
    send_on_shift_close: true,
    email_enabled: true,
    email_recipients: ["nuevo@negocio.co"],
    email_fallback_enabled: true,
    ...overrides
  };
}

function legacyRow(overrides: Partial<LegacyDailyReportSettingsRow> = {}): LegacyDailyReportSettingsRow {
  return {
    enabled: true,
    send_on_shift_close: true,
    whatsapp_enabled: true,
    whatsapp_recipients: ["573001112233"],
    email_enabled: true,
    email_recipients: ["viejo@negocio.co"],
    email_fallback_enabled: true,
    ...overrides
  };
}

function member(overrides: Partial<MemberCandidate> = {}): MemberCandidate {
  return { userId: "u1", role: "ADMIN", email: "admin@negocio.co", profileStatus: "ACTIVE", authDisabled: false, ...overrides };
}

function settings(overrides: Partial<CloseSettings> = {}): CloseSettings {
  return { ...mergeCloseSettings(freshRow({ email_recipients: [] }), null), ...overrides };
}

/* ------------------------------------------------------------------------- */

describe("listas de correo", () => {
  it("normaliza: minúsculas, sin repetidos, descarta inválidos y respeta el tope", () => {
    expect(normalizeEmailList([" A@B.co ", "a@b.co", "malo", "", null, "c@d.co"])).toEqual(["a@b.co", "c@d.co"]);
    expect(normalizeEmailList(["1@a.co", "2@a.co", "3@a.co"], 2)).toEqual(["1@a.co", "2@a.co"]);
    expect(normalizeEmailList("no-es-lista")).toEqual([]);
    expect(normalizeEmailList(null)).toEqual([]);
  });

  it("hasEntries distingue lista vacía/en blanco de lista con algo escrito", () => {
    expect(hasEntries([])).toBe(false);
    expect(hasEntries(["", "  "])).toBe(false);
    expect(hasEntries(["malo"])).toBe(true);
    expect(hasEntries(null)).toBe(false);
  });
});

describe("mergeCloseSettings: tabla nueva con respaldo al sistema anterior", () => {
  it("con fila nueva (global) manda la fila nueva y conserva WhatsApp del sistema anterior", () => {
    const s = mergeCloseSettings(freshRow(), legacyRow());
    expect(s.source).toBe("business");
    expect(s.emailRecipients).toEqual(["nuevo@negocio.co"]);
    expect(s.whatsappEnabled).toBe(true);
    expect(s.whatsappRecipients).toEqual(["573001112233"]);
  });

  it("con override de sucursal marca source=branch", () => {
    expect(mergeCloseSettings(freshRow({ branch_id: BR }), null).source).toBe("branch");
  });

  it("la fila nueva manda aunque el sistema anterior diga otra cosa (enabled=false nuevo apaga el cierre)", () => {
    const s = mergeCloseSettings(freshRow({ enabled: false, send_on_shift_close: false }), legacyRow({ enabled: true }));
    expect(s.enabled).toBe(false);
    expect(s.sendOnShiftClose).toBe(false);
  });

  it("sin fila nueva usa el sistema anterior tal cual", () => {
    const s = mergeCloseSettings(null, legacyRow({ email_fallback_enabled: false, email_recipients: [] }));
    expect(s.source).toBe("legacy");
    expect(s.emailRecipients).toEqual([]);
    expect(s.emailFallbackEnabled).toBe(false);
    // Comportamiento histórico: el sistema anterior SIEMPRE caía a ADMIN/GERENTE con la lista vacía.
    expect(s.useAdminWhenEmpty).toBe(true);
    expect(s.whatsappEnabled).toBe(true);
  });

  it("en la tabla nueva el respaldo lo decide email_fallback_enabled", () => {
    expect(mergeCloseSettings(freshRow({ email_fallback_enabled: false }), null).useAdminWhenEmpty).toBe(false);
    expect(mergeCloseSettings(freshRow({ email_fallback_enabled: true }), null).useAdminWhenEmpty).toBe(true);
  });

  it("sin ninguna fila: defaults (activo, correo activo, respaldo activo, WhatsApp apagado)", () => {
    const s = mergeCloseSettings(null, null);
    expect(s).toMatchObject({
      source: "default",
      enabled: true,
      sendOnShiftClose: true,
      emailEnabled: true,
      emailRecipients: [],
      useAdminWhenEmpty: true,
      whatsappEnabled: false,
      whatsappRecipients: []
    });
  });

  it("email_recipients null en la base no rompe", () => {
    expect(mergeCloseSettings(freshRow({ email_recipients: null }), null).emailRecipients).toEqual([]);
  });
});

describe("loadCloseSettings", () => {
  it("consulta ambas fuentes con el negocio y la sucursal del cierre", async () => {
    const calls: unknown[][] = [];
    const store: CloseSettingsStore = {
      async fetchResolvedCloseSettings(b, br) {
        calls.push(["fresh", b, br]);
        return freshRow({ branch_id: br });
      },
      async fetchLegacySettings(b) {
        calls.push(["legacy", b]);
        return legacyRow();
      }
    };
    const s = await loadCloseSettings(store, BIZ, BR);
    expect(s.source).toBe("branch");
    expect(calls).toContainEqual(["fresh", BIZ, BR]);
    expect(calls).toContainEqual(["legacy", BIZ]);
  });

  it("un error de lectura se propaga (no se inventan defaults)", async () => {
    const store: CloseSettingsStore = {
      fetchResolvedCloseSettings: async () => {
        throw new Error("REPORT_SETTINGS_READ_FAILED: boom");
      },
      fetchLegacySettings: async () => null
    };
    await expect(loadCloseSettings(store, BIZ, BR)).rejects.toThrow(/REPORT_SETTINGS_READ_FAILED/);
  });
});

describe("isMissingSchemaError (migración sin aplicar)", () => {
  it("reconoce función/tabla inexistente por código o por mensaje", () => {
    for (const code of ["PGRST202", "PGRST205", "42883", "42P01"]) expect(isMissingSchemaError({ code })).toBe(true);
    expect(isMissingSchemaError({ message: "Could not find the function public.resolve_report_close_settings" })).toBe(true);
    expect(isMissingSchemaError({ message: 'relation "x" does not exist' })).toBe(true);
  });

  it("no confunde otros errores", () => {
    expect(isMissingSchemaError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingSchemaError({ message: "timeout" })).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
  });
});

describe("pickFallbackEmails: ADMIN o GERENTE activo", () => {
  it("toma ADMIN y GERENTE, ADMIN primero, sin repetidos", () => {
    const emails = pickFallbackEmails([
      member({ userId: "g", role: "GERENTE", email: "gerente@negocio.co" }),
      member({ userId: "a", role: "ADMIN", email: "Admin@Negocio.co" }),
      member({ userId: "a2", role: "ADMIN", email: "admin@negocio.co" })
    ]);
    expect(emails).toEqual(["admin@negocio.co", "gerente@negocio.co"]);
  });

  it("ignora otros roles", () => {
    expect(pickFallbackEmails([member({ role: "CAJERO" }), member({ role: "MESERO" }), member({ role: "CONTADOR" })])).toEqual([]);
  });

  it("ignora perfiles suspendidos o eliminados y cuentas bloqueadas", () => {
    expect(
      pickFallbackEmails([
        member({ userId: "1", email: "suspendido@n.co", profileStatus: "SUSPENDED" }),
        member({ userId: "2", email: "eliminado@n.co", profileStatus: "DELETED" }),
        member({ userId: "3", email: "bloqueado@n.co", authDisabled: true }),
        member({ userId: "4", email: "activo@n.co", profileStatus: "ACTIVE" })
      ])
    ).toEqual(["activo@n.co"]);
  });

  it("un miembro sin perfil (p. ej. el dueño original) cuenta como activo", () => {
    expect(pickFallbackEmails([member({ profileStatus: null })])).toEqual(["admin@negocio.co"]);
  });

  it("ignora los que no tienen correo válido", () => {
    expect(pickFallbackEmails([member({ email: null }), member({ email: "malo" }), member({ email: "" })])).toEqual([]);
  });

  it("acepta el rol en cualquier capitalización y respeta el tope", () => {
    const many = Array.from({ length: 8 }, (_, i) => member({ userId: `u${i}`, role: " admin ", email: `a${i}@n.co` }));
    expect(pickFallbackEmails(many)).toHaveLength(5);
    expect(pickFallbackEmails(many, 2)).toEqual(["a0@n.co", "a1@n.co"]);
  });
});

describe("resolveEmailRecipients", () => {
  const noFallback = async () => {
    throw new Error("no debía consultarse el respaldo");
  };

  it("usa el correo configurado y NO consulta el respaldo", async () => {
    const r = await resolveEmailRecipients(settings({ emailRecipients: [" Dueno@Negocio.co "] }), noFallback);
    expect(r).toEqual({ recipients: ["dueno@negocio.co"], origin: "configured", reason: null });
  });

  it("correo principal vacío: toma el del ADMIN/GERENTE activo", async () => {
    const r = await resolveEmailRecipients(settings({ emailRecipients: [] }), async () => ["admin@negocio.co", "ADMIN@negocio.co", "gerente@negocio.co"]);
    expect(r.origin).toBe("fallback");
    expect(r.recipients).toEqual(["admin@negocio.co", "gerente@negocio.co"]);
    expect(r.reason).toBeNull();
  });

  it("lista en blanco cuenta como vacía", async () => {
    const r = await resolveEmailRecipients(settings({ emailRecipients: ["  ", ""] }), async () => ["admin@negocio.co"]);
    expect(r.origin).toBe("fallback");
  });

  it("sin correo y sin ADMIN/GERENTE con correo: no hay destinatarios y explica por qué", async () => {
    const r = await resolveEmailRecipients(settings({ emailRecipients: [] }), async () => []);
    expect(r.recipients).toEqual([]);
    expect(r.origin).toBe("none");
    expect(r.reason).toMatch(/ADMIN o GERENTE activo/);
  });

  it("respaldo desactivado en la tabla nueva: no se usa y se explica", async () => {
    const r = await resolveEmailRecipients(settings({ emailRecipients: [], useAdminWhenEmpty: false }), noFallback);
    expect(r.origin).toBe("none");
    expect(r.reason).toMatch(/desactivado/);
  });

  it("correo escrito pero inválido: error visible, NO se reemplaza por el de otra persona", async () => {
    const r = await resolveEmailRecipients(settings({ emailRecipients: ["malo"] }), noFallback);
    expect(r.origin).toBe("none");
    expect(r.reason).toMatch(/no es válido/);
  });

  it("canal de correo apagado: nada que enviar", async () => {
    const r = await resolveEmailRecipients(settings({ emailEnabled: false, emailRecipients: ["a@b.co"] }), noFallback);
    expect(r.recipients).toEqual([]);
    expect(r.reason).toMatch(/desactivado/);
  });
});

/* ------------------------------------------------------------------------- */

function testDeps(overrides: Partial<TestEmailDeps> = {}) {
  const sent: Array<{ to: string; subject: string }> = [];
  const deps: TestEmailDeps = {
    async sendEmail(to, content) {
      sent.push({ to, subject: content.subject });
      return `re_${sent.length}`;
    },
    loadSettings: async () => settings({ emailRecipients: [] }),
    loadFallbackEmails: async () => ["admin@negocio.co"],
    buildContent: () => ({ subject: "Prueba", text: "t", html: "<p>t</p>" }),
    ...overrides
  };
  return { deps, sent };
}

describe("handleTestEmail", () => {
  it("ADMIN con un correo válido: envía y responde con mensaje en español", async () => {
    const { deps, sent } = testDeps();
    const r = await handleTestEmail(deps, { isWorker: false, role: "ADMIN", recipient: " Dueno@Negocio.co " });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, recipient: "dueno@negocio.co", recipients: ["dueno@negocio.co"], origin: "manual", providerId: "re_1" });
    expect((r.body as { message: string }).message).toMatch(/Correo de prueba enviado a dueno@negocio\.co/);
    expect(sent).toEqual([{ to: "dueno@negocio.co", subject: "Prueba" }]);
  });

  it("solo el ADMIN: GERENTE, CAJERO, sin rol y el worker reciben 403 y no se envía nada", async () => {
    for (const input of [
      { isWorker: false, role: "GERENTE" },
      { isWorker: false, role: "CAJERO" },
      { isWorker: false, role: null },
      { isWorker: true, role: null },
      { isWorker: true, role: "ADMIN" }
    ]) {
      const { deps, sent } = testDeps();
      const r = await handleTestEmail(deps, { ...input, recipient: "a@b.co" });
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect((r.body as { message: string }).message).toMatch(/administrador/);
      expect(sent).toHaveLength(0);
    }
  });

  it("correo inválido: 400 INVALID_EMAIL señalando el correo", async () => {
    const { deps, sent } = testDeps();
    const r = await handleTestEmail(deps, { isWorker: false, role: "ADMIN", recipient: "no-es-correo" });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ ok: false, code: "INVALID_EMAIL", error: "INVALID_EMAIL" });
    expect((r.body as { message: string }).message).toContain("no-es-correo");
    expect(sent).toHaveLength(0);
  });

  it("varios correos juntos: 400 MULTIPLE_EMAILS", async () => {
    const { deps, sent } = testDeps();
    for (const recipient of ["a@b.co, c@d.co", "a@b.co;c@d.co", "a@b.co c@d.co"]) {
      const r = await handleTestEmail(deps, { isWorker: false, role: "ADMIN", recipient });
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ ok: false, code: "MULTIPLE_EMAILS" });
    }
    expect(sent).toHaveLength(0);
  });

  it("sin correo escrito prueba el respaldo: manda al ADMIN/GERENTE activo", async () => {
    const { deps, sent } = testDeps({ loadFallbackEmails: async () => ["admin@negocio.co", "gerente@negocio.co"] });
    const r = await handleTestEmail(deps, { isWorker: false, role: "ADMIN", recipient: "   " });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, origin: "fallback", recipients: ["admin@negocio.co", "gerente@negocio.co"] });
    expect(sent.map((item) => item.to)).toEqual(["admin@negocio.co", "gerente@negocio.co"]);
  });

  it("sin correo escrito y con correo configurado: prueba el configurado", async () => {
    const { deps, sent } = testDeps({ loadSettings: async () => settings({ emailRecipients: ["dueno@negocio.co"] }) });
    const r = await handleTestEmail(deps, { isWorker: false, role: "ADMIN" });
    expect(r.body).toMatchObject({ ok: true, origin: "configured" });
    expect(sent.map((item) => item.to)).toEqual(["dueno@negocio.co"]);
  });

  it("sin correo escrito y sin a quién enviar: 422 NO_RECIPIENTS con instrucción clara", async () => {
    const { deps, sent } = testDeps({ loadFallbackEmails: async () => [] });
    const r = await handleTestEmail(deps, { isWorker: false, role: "ADMIN" });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ ok: false, code: "NO_RECIPIENTS" });
    expect((r.body as { message: string }).message).toMatch(/Escribe un correo/);
    expect(sent).toHaveLength(0);
  });

  it("no se pudo leer la configuración: 500 UNEXPECTED sin filtrar el detalle", async () => {
    const { deps } = testDeps({
      loadSettings: async () => {
        throw new Error("REPORT_SETTINGS_READ_FAILED: password=secreto");
      }
    });
    const r = await handleTestEmail(deps, { isWorker: false, role: "ADMIN" });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secreto");
  });

  it.each([
    ["CONFIG", 503, "EMAIL_NOT_CONFIGURED"],
    ["RETRY", 502, "EMAIL_TEMPORARY_FAILURE"],
    ["FAILED", 422, "EMAIL_REJECTED"]
  ] as const)("fallo %s de Resend -> HTTP %i %s con el mensaje en español", async (kind, status, code) => {
    const { deps } = testDeps({
      sendEmail: async () => {
        throw new EmailSendError(kind, "RESEND_X", "Mensaje claro en español.");
      }
    });
    const r = await handleTestEmail(deps, { isWorker: false, role: "ADMIN", recipient: "a@b.co" });
    expect(r.status).toBe(status);
    expect(r.body).toMatchObject({ ok: false, code, message: "Mensaje claro en español." });
  });

  it("error inesperado al enviar: 500 genérico, sin filtrar el detalle interno", async () => {
    const { deps } = testDeps({
      sendEmail: async () => {
        throw new Error("fallo interno con api_key=re_secreta");
      }
    });
    const r = await handleTestEmail(deps, { isWorker: false, role: "ADMIN", recipient: "a@b.co" });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ ok: false, code: "UNEXPECTED" });
    expect(JSON.stringify(r.body)).not.toContain("re_secreta");
  });

  it("envío parcial al respaldo: ok=true, informa cuál falló", async () => {
    const { deps } = testDeps({
      loadFallbackEmails: async () => ["admin@negocio.co", "gerente@negocio.co"],
      sendEmail: async (to) => {
        if (to.startsWith("gerente")) throw new EmailSendError("FAILED", "RESEND_REJECTED", "Rechazado.");
        return "re_ok";
      }
    });
    const r = await handleTestEmail(deps, { isWorker: false, role: "ADMIN" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      ok: true,
      recipients: ["admin@negocio.co"],
      failed: [{ recipient: "gerente@negocio.co", message: "Rechazado." }]
    });
    expect((r.body as { message: string }).message).toMatch(/falló para gerente@negocio\.co/);
  });
});