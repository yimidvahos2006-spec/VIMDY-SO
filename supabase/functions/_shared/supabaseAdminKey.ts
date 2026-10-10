/**
 * VIMDY — Supabase privileged API key accessor.
 *
 * Production:
 *   Supabase injects `SUPABASE_SECRET_KEYS` as a JSON object. This accessor
 *   selects the specifically named secret API key created for the P0.1
 *   credential rotation. New `sb_secret_...` keys must be sent by the current
 *   Supabase JS SDK through the `apikey` header, not as a Bearer JWT.
 *
 * Local development only:
 *   If `SUPABASE_SECRET_KEYS` is absent, `VIMDY_SUPABASE_SECRET_KEY` may be
 *   supplied through an ignored local env file. Never commit its value.
 *
 * Security:
 *   - Never logs or returns the key in an error message.
 *   - Does not fall back to the exposed legacy SUPABASE_SERVICE_ROLE_KEY.
 *   - Returns undefined when the named key is unavailable so existing
 *     handlers can fail closed instead of silently using another credential.
 */

const ROTATED_SECRET_KEY_NAME = "vimdy_backend_rotation_20261009";

function isSecretApiKey(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("sb_secret_");
}

export function getSupabaseAdminKey(): string | undefined {
  const injectedKeys = Deno.env.get("SUPABASE_SECRET_KEYS");

  if (injectedKeys) {
    try {
      const parsed: unknown = JSON.parse(injectedKeys);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return undefined;
      }

      const candidate = (parsed as Record<string, unknown>)[ROTATED_SECRET_KEY_NAME];
      return isSecretApiKey(candidate) ? candidate : undefined;
    } catch {
      // Fail closed. Do not print environment content because it contains secrets.
      return undefined;
    }
  }

  // Explicit local-development override; never configured as a production fallback.
  const localKey = Deno.env.get("VIMDY_SUPABASE_SECRET_KEY");
  return isSecretApiKey(localKey) ? localKey : undefined;
}
