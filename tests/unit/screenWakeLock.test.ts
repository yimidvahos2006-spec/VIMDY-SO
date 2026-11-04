import { describe, expect, it } from "vitest";

import {
  createScreenWakeLock,
  type ScreenWakeLockEnv,
  type WakeLockSentinelLike
} from "../../src/core/services/screenWakeLock";

function makeEnv(options: { fail?: boolean; unsupported?: boolean } = {}) {
  const visibilityListeners = new Set<() => void>();
  const doc = {
    visibilityState: "visible",
    addEventListener: (_t: "visibilitychange", l: () => void) => visibilityListeners.add(l),
    removeEventListener: (_t: "visibilitychange", l: () => void) => visibilityListeners.delete(l)
  };
  const sentinels: Array<WakeLockSentinelLike & { fireRelease(): void; released: boolean }> = [];

  const env: ScreenWakeLockEnv = {
    document: doc,
    wakeLock: options.unsupported
      ? null
      : {
          async request() {
            if (options.fail) throw new Error("NotAllowedError");
            let onRelease: () => void = () => undefined;
            const sentinel = {
              released: false,
              async release() {
                sentinel.released = true;
              },
              addEventListener: (_t: "release", l: () => void) => {
                onRelease = l;
              },
              fireRelease: () => onRelease()
            };
            sentinels.push(sentinel);
            return sentinel;
          }
        }
  };

  return {
    env,
    sentinels,
    setVisibility(state: string) {
      doc.visibilityState = state;
      visibilityListeners.forEach(l => l());
    },
    visibilityListenerCount: () => visibilityListeners.size
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("screenWakeLock", () => {
  it("queda en 'unsupported' si el navegador no soporta la API", () => {
    const { env } = makeEnv({ unsupported: true });
    const lock = createScreenWakeLock(env);
    lock.start();
    expect(lock.getStatus()).toBe("unsupported");
  });

  it("pide el bloqueo al iniciar y lo suelta al detener", async () => {
    const h = makeEnv();
    const lock = createScreenWakeLock(h.env);
    lock.start();
    await flush();
    expect(lock.getStatus()).toBe("active");

    await lock.stop();
    expect(lock.getStatus()).toBe("inactive");
    expect(h.sentinels[0].released).toBe(true);
    expect(h.visibilityListenerCount()).toBe(0);
  });

  it("lo vuelve a pedir cuando el navegador lo suelta y la pestaña vuelve a verse", async () => {
    const h = makeEnv();
    const lock = createScreenWakeLock(h.env);
    lock.start();
    await flush();

    h.setVisibility("hidden");
    h.sentinels[0].fireRelease();
    expect(lock.getStatus()).toBe("inactive");

    h.setVisibility("visible");
    await flush();
    expect(h.sentinels).toHaveLength(2);
    expect(lock.getStatus()).toBe("active");
  });

  it("si la petición falla queda en 'failed' sin lanzar error y reintenta al volver", async () => {
    const h = makeEnv({ fail: true });
    const lock = createScreenWakeLock(h.env);
    lock.start();
    await flush();
    expect(lock.getStatus()).toBe("failed");
  });

  it("no queda un bloqueo huérfano si se detiene mientras la petición está en vuelo", async () => {
    const h = makeEnv();
    const lock = createScreenWakeLock(h.env);
    lock.start();
    await lock.stop();
    await flush();
    expect(lock.getStatus()).toBe("inactive");
    expect(h.sentinels.every(s => s.released)).toBe(true);
  });

  it("no pide el bloqueo con la pestaña oculta", async () => {
    const h = makeEnv();
    h.setVisibility("hidden");
    const lock = createScreenWakeLock(h.env);
    lock.start();
    await flush();
    expect(h.sentinels).toHaveLength(0);
  });
});