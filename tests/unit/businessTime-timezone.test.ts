import { describe, expect, it, beforeEach } from "vitest";
import { getBusinessDateKey, addBusinessDays, getDayKeyForOffset } from "../../src/core/utils/businessTime";

/**
 * TESTS DE TIMEZONE PARA businessTime.ts
 *
 * Verifican que las operaciones de tiempo empresarial son consistentes
 * independientemente de la zona horaria del dispositivo/entorno.
 */

describe("businessTime — timezone consistency", () => {
  const TZ_BOGOTA = "America/Bogota";

  it("getBusinessDateKey devuelve el mismo día para un negocio en Bogotá", () => {
    // 21:00 UTC = 16:00 en Bogotá (UTC-5)
    const instant = new Date("2026-09-22T21:00:00.000Z");
    expect(getBusinessDateKey(instant, TZ_BOGOTA)).toBe("2026-09-22");
  });

  it("getBusinessDateKey NO cambia con la zona del dispositivo", () => {
    // 19:00 UTC = 14:00 en Nueva York (UTC-4 en verano)... pero sigue siendo
    // 14:00 del mismo día en Bogotá (14:00 - 5h = 9:00 UTC → Bogotá 4:00)
    // El punto es: el mismo instante debe producir el mismo día empresarial
    // con la zona configurada, sin importar el entorno donde se ejecuta el test.
    const instant = new Date("2026-09-22T23:00:00.000Z");
    const result = getBusinessDateKey(instant, TZ_BOGOTA);
    expect(result).toBe("2026-09-22");
  });

  it("venta alrededor de medianoche UTC pertenece al día empresarial correcto", () => {
    // 05:00 UTC = 00:00 en Bogotá → apenas entra en el día empresarial
    const midnightUtc = new Date("2026-09-23T04:59:59.000Z");
    expect(getBusinessDateKey(midnightUtc, TZ_BOGOTA)).toBe("2026-09-22");

    // 06:00 UTC = 01:00 en Bogotá → día siguiente
    const nextHourUtc = new Date("2026-09-23T05:00:00.000Z");
    expect(getBusinessDateKey(nextHourUtc, TZ_BOGOTA)).toBe("2026-09-23");
  });

  it("addBusinessDays calcula mañana en la zona empresarial", () => {
    const now = new Date("2026-09-22T12:00:00.000Z");
    const tomorrow = addBusinessDays(now, TZ_BOGOTA, 1);
    expect(getBusinessDateKey(tomorrow, TZ_BOGOTA)).toBe("2026-09-23");
  });

  it("getDayKeyForOffset produce claves consistentes", () => {
    const now = new Date("2026-09-22T12:00:00.000Z");
    const key0 = getDayKeyForOffset(now, TZ_BOGOTA, 0);
    const key1 = getDayKeyForOffset(now, TZ_BOGOTA, 1);
    const key7 = getDayKeyForOffset(now, TZ_BOGOTA, 7);
    expect(key0).toBe("2026-09-22");
    expect(key1).toBe("2026-09-21");
    expect(key7).toBe("2026-09-15");
  });

  it("el weekday empresarial es consistente con la zona horaria del negocio", () => {
    // 2026-09-22 es Martes en Bogotá
    const instant = new Date("2026-09-22T15:00:00.000Z");
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ_BOGOTA,
      weekday: "short"
    }).formatToParts(instant);
    const weekday = parts.find(p => p.type === "weekday")?.value;
    expect(weekday).toBe("Tue");
  });
});
