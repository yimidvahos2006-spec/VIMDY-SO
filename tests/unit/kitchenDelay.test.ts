import { afterEach, describe, expect, it, vi } from "vitest";

import {
  computeKitchenDelay,
  DEFAULT_PREP_MINUTES,
  resolveTargetMinutes,
  splitElapsed
} from "../../src/core/services/kitchenDelay";
import { computeColumnFit } from "../../src/presentation/components/dashboard/kitchen/columnFit";
import { getKitchenNow, subscribeKitchenClock } from "../../src/hooks/useKitchenClock";

const T0 = new Date("2026-11-03T19:00:00Z").getTime();
const minutes = (n: number) => n * 60 * 1000;

describe("alerta de demora según el tiempo de cada pedido", () => {
  it("usa 15 min cuando el pedido no trae tiempo estimado o es inválido", () => {
    expect(resolveTargetMinutes(undefined)).toBe(DEFAULT_PREP_MINUTES);
    expect(resolveTargetMinutes(null)).toBe(DEFAULT_PREP_MINUTES);
    expect(resolveTargetMinutes(0)).toBe(DEFAULT_PREP_MINUTES);
    expect(resolveTargetMinutes(-4)).toBe(DEFAULT_PREP_MINUTES);
    expect(resolveTargetMinutes(Number.NaN)).toBe(DEFAULT_PREP_MINUTES);
    expect(resolveTargetMinutes(8)).toBe(8);
  });

  it("una bebida de 3 min se demora mucho antes que un plato de 30 min", () => {
    const now = T0 + minutes(5);
    expect(computeKitchenDelay(T0, 3, now).level).toBe("DELAYED");
    expect(computeKitchenDelay(T0, 30, now).level).toBe("ON_TIME");
  });

  it("pasa de en tiempo a por vencer al 70 % y a demorado al cumplir la meta", () => {
    // meta 10 min: por vencer desde 7 min, demorado desde 10 min
    expect(computeKitchenDelay(T0, 10, T0 + minutes(6) + 59_000).level).toBe("ON_TIME");
    expect(computeKitchenDelay(T0, 10, T0 + minutes(7)).level).toBe("WARNING");
    expect(computeKitchenDelay(T0, 10, T0 + minutes(10) - 1000).level).toBe("WARNING");
    expect(computeKitchenDelay(T0, 10, T0 + minutes(10)).level).toBe("DELAYED");
  });

  it("calcula cuánto se pasó de la meta", () => {
    const info = computeKitchenDelay(T0, 10, T0 + minutes(13) + 20_000);
    expect(info.overdueSeconds).toBe(200);
    expect(info.targetMinutes).toBe(10);
    expect(computeKitchenDelay(T0, 10, T0 + minutes(4)).overdueSeconds).toBe(0);
  });

  it("nunca da tiempos negativos ni NaN (reloj atrasado o fecha inválida)", () => {
    expect(computeKitchenDelay(T0 + minutes(5), 10, T0).elapsedSeconds).toBe(0);
    expect(computeKitchenDelay("no-es-fecha", 10, T0).elapsedSeconds).toBe(0);
    expect(computeKitchenDelay("no-es-fecha", 10, T0).level).toBe("ON_TIME");
  });

  it("acepta fecha como texto (así llega desde la base de datos)", () => {
    const info = computeKitchenDelay("2026-11-03T19:00:00Z", 10, T0 + minutes(2));
    expect(info.elapsedSeconds).toBe(120);
  });

  it("parte los segundos en minutos y segundos", () => {
    expect(splitElapsed(0)).toEqual({ minutes: 0, seconds: 0 });
    expect(splitElapsed(65)).toEqual({ minutes: 1, seconds: 5 });
    expect(splitElapsed(3725)).toEqual({ minutes: 62, seconds: 5 });
    expect(splitElapsed(-9)).toEqual({ minutes: 0, seconds: 0 });
  });
});

describe("columna de alto fijo: cuántas tarjetas caben", () => {
  const card = (top: number, height: number) => ({ top, height });

  it("muestra todas si caben", () => {
    const fit = computeColumnFit([card(0, 300), card(320, 300)], 700);
    expect(fit).toEqual({ hiddenFrom: 2, firstTooTall: false });
  });

  it("oculta desde la primera que no cabe ENTERA", () => {
    const fit = computeColumnFit([card(0, 300), card(320, 300), card(640, 300), card(960, 300)], 700);
    expect(fit.hiddenFrom).toBe(2);
  });

  it("una tarjeta que cabe justo (con 1px de tolerancia) se muestra", () => {
    expect(computeColumnFit([card(0, 700)], 700).hiddenFrom).toBe(1);
    expect(computeColumnFit([card(0, 300), card(320, 380)], 700).hiddenFrom).toBe(2);
  });

  it("la primera tarjeta SIEMPRE se muestra aunque sea más alta que la columna", () => {
    const fit = computeColumnFit([card(0, 900), card(920, 300)], 700);
    expect(fit.firstTooTall).toBe(true);
    expect(fit.hiddenFrom).toBe(1);
  });

  it("sin medida todavía (alto 0) o sin pedidos no oculta nada", () => {
    expect(computeColumnFit([card(0, 300), card(320, 300)], 0).hiddenFrom).toBe(2);
    expect(computeColumnFit([], 700)).toEqual({ hiddenFrom: 0, firstTooTall: false });
  });
});

describe("reloj compartido de Cocina", () => {
  afterEach(() => vi.useRealTimers());

  it("avisa a todos una vez por segundo, justo al cambiar el segundo", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 400); // 400 ms dentro de un segundo

    const a = vi.fn();
    const b = vi.fn();
    const stopA = subscribeKitchenClock(a);
    const stopB = subscribeKitchenClock(b);

    expect(getKitchenNow()).toBe(T0);

    vi.advanceTimersByTime(700); // ya pasó el cambio de segundo
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(getKitchenNow()).toBe(T0 + 1000);

    vi.advanceTimersByTime(3000);
    expect(a).toHaveBeenCalledTimes(4);
    expect(getKitchenNow()).toBe(T0 + 4000);

    stopA();
    stopB();
  });

  it("al quedar sin suscriptores se detiene (no deja temporizadores colgados)", () => {
    vi.useFakeTimers();
    const stop = subscribeKitchenClock(() => undefined);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});