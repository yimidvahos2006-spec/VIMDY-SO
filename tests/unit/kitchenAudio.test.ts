import { describe, expect, it } from "vitest";

import { createKitchenAudio, type KitchenAudioEnv } from "../../src/core/services/kitchenAudio";

function makeEnv(options: { unsupported?: boolean; startsRunning?: boolean; resumeFails?: boolean } = {}) {
  const gestureListeners = new Map<string, Set<() => void>>();
  const visibilityListeners = new Set<() => void>();
  const stateListeners = new Set<() => void>();
  const doc = { visibilityState: "visible" };

  const ctx = {
    state: options.startsRunning ? "running" : "suspended",
    addEventListener: (_t: string, l: () => void) => stateListeners.add(l),
    async resume() {
      if (options.resumeFails) throw new Error("NotAllowedError");
      ctx.state = "running";
      stateListeners.forEach(l => l());
    }
  };

  const env: KitchenAudioEnv = {
    createContext: options.unsupported ? null : () => ctx as unknown as AudioContext,
    document: {
      get visibilityState() {
        return doc.visibilityState;
      },
      addEventListener: (_t, l) => visibilityListeners.add(l),
      removeEventListener: (_t, l) => visibilityListeners.delete(l)
    },
    gestureTarget: {
      addEventListener: (t, l) => {
        if (!gestureListeners.has(t)) gestureListeners.set(t, new Set());
        gestureListeners.get(t)!.add(l);
      },
      removeEventListener: (t, l) => gestureListeners.get(t)?.delete(l)
    }
  };

  const gestureCount = () => [...gestureListeners.values()].reduce((n, s) => n + s.size, 0);
  const fire = (type: string) => gestureListeners.get(type)?.forEach(l => l());

  const fireStateChange = () => stateListeners.forEach(l => l());

  return { env, ctx, doc, gestureCount, fire, visibilityListeners, fireStateChange };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("kitchenAudio", () => {
  it("sin soporte de Web Audio queda en 'unsupported'", () => {
    const { env } = makeEnv({ unsupported: true });
    const audio = createKitchenAudio(env);
    audio.start();
    expect(audio.getStatus()).toBe("unsupported");
    expect(audio.getContext()).toBeNull();
  });

  it("contexto suspendido (recarga) => 'blocked' y espera un gesto", () => {
    const { env, ctx, gestureCount } = makeEnv({ resumeFails: true });
    const audio = createKitchenAudio(env);
    audio.start();
    expect(ctx.state).toBe("suspended");
    expect(audio.getStatus()).toBe("blocked");
    expect(gestureCount()).toBeGreaterThan(0);
  });

  it("si el navegador ya permite audio, arranca 'enabled' sin tocar nada", async () => {
    const { env } = makeEnv({ startsRunning: true });
    const audio = createKitchenAudio(env);
    audio.start();
    await flush();
    expect(audio.getStatus()).toBe("enabled");
  });

  it("enable() desde un clic pasa a 'enabled' y avisa a los suscriptores", async () => {
    const { env } = makeEnv();
    // Simula que sin gesto no se puede: el primer resume del start() falla.
    let allowed = false;
    const original = env.createContext!;
    env.createContext = () => {
      const c = original() as unknown as { resume: () => Promise<void> };
      const realResume = c.resume.bind(c);
      c.resume = async () => {
        if (!allowed) throw new Error("NotAllowedError");
        await realResume();
      };
      return c as unknown as AudioContext;
    };

    const audio = createKitchenAudio(env);
    let notified = 0;
    audio.subscribe(() => notified++);
    audio.start();
    await flush();
    expect(audio.getStatus()).toBe("blocked");

    allowed = true; // el usuario hace clic
    expect(await audio.enable()).toBe("enabled");
    expect(notified).toBeGreaterThan(0);
  });

  it("enable() fallido deja 'blocked' sin lanzar error", async () => {
    const { env } = makeEnv({ resumeFails: true });
    const audio = createKitchenAudio(env);
    audio.start();
    expect(await audio.enable()).toBe("blocked");
  });

  it("cualquier gesto desbloquea y luego se sueltan los listeners", async () => {
    const { env, gestureCount, fire } = makeEnv();
    const audio = createKitchenAudio(env);
    audio.start();
    await flush();
    // En este doble resume() funciona, así que el start() ya lo habilitó:
    expect(audio.getStatus()).toBe("enabled");
    fire("pointerdown");
    await flush();
    expect(gestureCount()).toBe(0);
  });

  it("si el navegador suspende el contexto después (iOS 'interrupted'), vuelve a 'blocked'", async () => {
    const { env, ctx, fireStateChange } = makeEnv({ startsRunning: true });
    const audio = createKitchenAudio(env);
    audio.start();
    await flush();
    expect(audio.getStatus()).toBe("enabled");

    ctx.state = "interrupted";
    fireStateChange();
    expect(audio.getStatus()).toBe("blocked");
  });

  it("stop() quita los listeners y es idempotente", () => {
    const { env, gestureCount, visibilityListeners } = makeEnv({ resumeFails: true });
    const audio = createKitchenAudio(env);
    audio.start();
    audio.start();
    audio.stop();
    audio.stop();
    expect(gestureCount()).toBe(0);
    expect(visibilityListeners.size).toBe(0);
  });
});