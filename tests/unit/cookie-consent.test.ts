import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COOKIE_CONSENT_CHANGE_EVENT,
  COOKIE_CONSENT_KEY,
  hasAnalyticsConsent,
  readCookieConsent,
  saveCookieConsent,
} from "../../src/marketing/cookieConsent";

class FakeStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

describe("cookieConsent", () => {
  let storage: FakeStorage;
  let events: unknown[];

  beforeEach(() => {
    storage = new FakeStorage();
    events = [];
    (globalThis as { window?: unknown }).window = {
      localStorage: storage,
      dispatchEvent: (event: { type: string; detail?: unknown }) => {
        if (event.type === COOKIE_CONSENT_CHANGE_EVENT) events.push(event.detail);
        return true;
      },
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("sin decisión guardada no hay consentimiento (opt-in)", () => {
    expect(readCookieConsent()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("aceptar guarda analytics=true y emite el evento de cambio", () => {
    saveCookieConsent(true);
    expect(readCookieConsent()?.analytics).toBe(true);
    expect(hasAnalyticsConsent()).toBe(true);
    expect(events).toHaveLength(1);
  });

  it("rechazar guarda analytics=false y no cuenta como consentimiento", () => {
    saveCookieConsent(false);
    expect(readCookieConsent()?.analytics).toBe(false);
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("ignora valores corruptos o de otra versión", () => {
    storage.setItem(COOKIE_CONSENT_KEY, "{no es json");
    expect(readCookieConsent()).toBeNull();

    storage.setItem(
      COOKIE_CONSENT_KEY,
      JSON.stringify({ version: 99, analytics: true, decidedAt: "2026-11-04T00:00:00Z" }),
    );
    expect(readCookieConsent()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("no lanza si localStorage falla al escribir", () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    };
    expect(() => saveCookieConsent(true)).not.toThrow();
  });
});