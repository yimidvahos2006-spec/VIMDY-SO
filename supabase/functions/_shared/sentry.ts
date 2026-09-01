import * as Sentry from "npm:@sentry/deno@8";

const SENTRY_DSN = Deno.env.get("SENTRY_DSN");

Sentry.init({
  dsn: SENTRY_DSN ?? "",
  environment: Deno.env.get("SENTRY_ENVIRONMENT") ?? "production",
  tracesSampleRate: 0.2,
  enabled: Boolean(SENTRY_DSN)
});

export function sentryCaptureException(error: unknown, context?: Record<string, unknown>) {
  if (!SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }
    Sentry.captureException(error);
  });
}
