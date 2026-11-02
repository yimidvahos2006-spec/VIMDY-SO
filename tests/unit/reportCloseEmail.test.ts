import { describe, it, expect } from "vitest";
import {
  EmailSendError,
  classifyResendFailure,
  createResendClient,
  normalizeEmail
} from "../../supabase/functions/_shared/reportCloseEmail";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { impl, calls };
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function catchError(promise: Promise<unknown>): Promise<EmailSendError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(EmailSendError);
    return error as EmailSendError;
  }
  throw new Error("se esperaba un error");
}

describe("normalizeEmail", () => {
  it("pasa a minúsculas, recorta y rechaza lo inválido sin corregirlo", () => {
    expect(normalizeEmail("  Dueno@Negocio.CO ")).toBe("dueno@negocio.co");
    expect(normalizeEmail("sin-arroba")).toBeNull();
    expect(normalizeEmail("a b@c.co")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(`${"a".repeat(250)}@b.co`)).toBeNull();
  });
});

describe("createResendClient.send", () => {
  it("envía por la API de Resend con el cuerpo, la autorización y la Idempotency-Key", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, { id: "re_123" }));
    const client = createResendClient({ apiKey: "re_key", from: "VIMDY <reportes@vimdy.co>", fetchImpl: impl });

    const id = await client.send({
      to: " Dueno@Negocio.co ",
      subject: "Cierre",
      text: "texto",
      html: "<b>html</b>",
      idempotencyKey: "daily-report-delivery/abc"
    });

    expect(id).toBe("re_123");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_key");
    expect(headers["Idempotency-Key"]).toBe("daily-report-delivery/abc");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: "VIMDY <reportes@vimdy.co>",
      to: ["dueno@negocio.co"],
      subject: "Cierre",
      text: "texto",
      html: "<b>html</b>"
    });
  });

  it("sin html ni clave de idempotencia no manda esos campos; sin id en la respuesta devuelve null", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, {}));
    const client = createResendClient({ apiKey: "k", from: "f@vimdy.co", fetchImpl: impl });
    expect(await client.send({ to: "a@b.co", subject: "s", text: "t" })).toBeNull();
    expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty("html");
  });

  it("ignora una Idempotency-Key de más de 256 caracteres (Resend la rechazaría)", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, { id: "x" }));
    const client = createResendClient({ apiKey: "k", from: "f@vimdy.co", fetchImpl: impl });
    await client.send({ to: "a@b.co", subject: "s", text: "t", idempotencyKey: "k".repeat(257) });
    expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
  });

  it("sin clave o sin remitente: CONFIG y no llama a la red", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, { id: "x" }));
    for (const config of [{ apiKey: "", from: "f@vimdy.co" }, { apiKey: "k", from: null }, {}]) {
      const error = await catchError(createResendClient({ ...config, fetchImpl: impl }).send({ to: "a@b.co", subject: "s", text: "t" }));
      expect(error.code).toBe("CONFIG");
      expect(error.reason).toBe("RESEND_NOT_CONFIGURED");
      expect(error.message).toMatch(/^RESEND_NOT_CONFIGURED:/);
    }
    expect(calls).toHaveLength(0);
  });

  it("destinatario inválido: FAILED y no llama a la red", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, { id: "x" }));
    const error = await catchError(createResendClient({ apiKey: "k", from: "f@vimdy.co", fetchImpl: impl }).send({ to: "malo", subject: "s", text: "t" }));
    expect(error.code).toBe("FAILED");
    expect(error.reason).toBe("INVALID_RECIPIENT");
    expect(calls).toHaveLength(0);
  });

  it("error de red: RETRY", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const error = await catchError(createResendClient({ apiKey: "k", from: "f@vimdy.co", fetchImpl: impl }).send({ to: "a@b.co", subject: "s", text: "t" }));
    expect(error.code).toBe("RETRY");
    expect(error.reason).toBe("RESEND_NETWORK");
    expect(error.httpStatus).toBeNull();
  });

  it("tiempo agotado: aborta la petición y devuelve RETRY", async () => {
    const impl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as unknown as typeof fetch;
    const error = await catchError(
      createResendClient({ apiKey: "k", from: "f@vimdy.co", fetchImpl: impl, timeoutMs: 10 }).send({ to: "a@b.co", subject: "s", text: "t" })
    );
    expect(error.code).toBe("RETRY");
    expect(error.reason).toBe("RESEND_TIMEOUT");
  });

  it("respuesta de error con cuerpo no JSON: se clasifica por estado HTTP", async () => {
    const { impl } = fakeFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const error = await catchError(createResendClient({ apiKey: "k", from: "f@vimdy.co", fetchImpl: impl }).send({ to: "a@b.co", subject: "s", text: "t" }));
    expect(error.code).toBe("RETRY");
    expect(error.httpStatus).toBe(502);
  });

  it("propaga la clasificación de Resend (dominio sin verificar)", async () => {
    const { impl } = fakeFetch(() => jsonResponse(403, { name: "validation_error", message: "The vimdy.co domain is not verified." }));
    const error = await catchError(createResendClient({ apiKey: "k", from: "f@vimdy.co", fetchImpl: impl }).send({ to: "a@b.co", subject: "s", text: "t" }));
    expect(error.code).toBe("CONFIG");
    expect(error.reason).toBe("RESEND_DOMAIN_NOT_VERIFIED");
    expect(error.userMessage).toMatch(/dominio/);
  });
});

describe("classifyResendFailure", () => {
  const cases: Array<[string, number, Record<string, unknown>, string, string]> = [
    ["clave ausente", 401, { name: "missing_api_key" }, "CONFIG", "RESEND_API_KEY_INVALID"],
    ["clave inexistente (validation_error 401)", 401, { name: "validation_error", message: "API key is invalid" }, "CONFIG", "RESEND_API_KEY_INVALID"],
    ["clave suspendida", 403, { name: "suspended_api_key" }, "CONFIG", "RESEND_API_KEY_INVALID"],
    ["dominio sin verificar", 403, { name: "validation_error", message: "The domain is not verified" }, "CONFIG", "RESEND_DOMAIN_NOT_VERIFIED"],
    ["modo de pruebas", 403, { name: "validation_error", message: "You can only send testing emails to your own email address" }, "CONFIG", "RESEND_TESTING_MODE"],
    ["403 genérico", 403, { name: "validation_error", message: "otra cosa" }, "CONFIG", "RESEND_FORBIDDEN"],
    ["envío en curso", 409, { name: "concurrent_idempotent_requests" }, "RETRY", "RESEND_IN_PROGRESS"],
    ["idempotencia con otro cuerpo", 409, { name: "invalid_idempotent_request" }, "FAILED", "RESEND_IDEMPOTENCY_CONFLICT"],
    ["límite por segundo", 429, { name: "rate_limit_exceeded" }, "RETRY", "RESEND_RATE_LIMITED"],
    ["cuota diaria", 429, { name: "daily_quota_exceeded" }, "RETRY", "RESEND_QUOTA_EXCEEDED"],
    ["cuota mensual", 429, { name: "monthly_quota_exceeded" }, "RETRY", "RESEND_QUOTA_EXCEEDED"],
    ["error del proveedor", 500, { name: "application_error" }, "RETRY", "RESEND_UNAVAILABLE"],
    ["servicio no disponible", 503, { name: "service_unavailable" }, "RETRY", "RESEND_UNAVAILABLE"],
    ["destinatario rechazado", 422, { name: "validation_error", message: "Invalid `to` field" }, "FAILED", "RESEND_INVALID_RECIPIENT"],
    ["dato inválido", 400, { name: "validation_error", message: "Invalid `subject` field." }, "FAILED", "RESEND_REJECTED"],
    ["campo faltante", 422, { name: "missing_required_field" }, "FAILED", "RESEND_REJECTED"],
    ["otro 4xx", 418, {}, "FAILED", "RESEND_HTTP_418"]
  ];

  it.each(cases)("%s -> %s", (_label, status, body, code, reason) => {
    const error = classifyResendFailure(status, body);
    expect(error.code).toBe(code);
    expect(error.reason).toBe(reason);
    expect(error.httpStatus).toBe(status);
  });

  it("todos los mensajes al usuario están en español y no filtran el texto del proveedor", () => {
    for (const [, status, body] of cases) {
      const error = classifyResendFailure(status, { ...body, message: "SECRET-PROVIDER-DETAIL " + String(body.message ?? "") });
      expect(error.userMessage).toMatch(/[áéíóúñ]|correo|servicio|envío|Avísale|dominio|destinatario/i);
      expect(error.userMessage).not.toMatch(/SECRET-PROVIDER-DETAIL/);
    }
  });

  it("tolera cuerpo ausente", () => {
    expect(classifyResendFailure(500, null).code).toBe("RETRY");
    expect(classifyResendFailure(400, undefined).code).toBe("FAILED");
  });
});