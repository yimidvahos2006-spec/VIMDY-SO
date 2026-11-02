// tests/unit/waiterEngine.test.ts
/* ===========================================================================
   Tarjetas de meseros: nombre, foto y reglas de datos del WaiterEngine.
   Usa el repositorio en memoria (mismo contrato de bloqueo optimista que
   producción).
   =========================================================================== */
import { describe, it, expect, beforeEach } from "vitest";

import { WaiterEngine } from "../../src/core/engines/WaiterEngine";
import type { Waiter } from "../../src/core/entities/Entities";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import {
  WAITER_NAME_MAX_LENGTH,
  normalizeWaiterName,
  waiterNameKey,
  waiterPhotoProblem
} from "../../src/core/utils/waiterProfile";
import { translateBusinessError } from "../../src/core/errors/translateBusinessError";

const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";

describe("reglas puras de nombre y foto", () => {
  it("normaliza espacios y compara sin tildes ni mayúsculas", () => {
    expect(normalizeWaiterName("  Juan   Pérez ")).toBe("Juan Pérez");
    expect(waiterNameKey("JOSÉ")).toBe(waiterNameKey(" jose "));
  });

  it("acepta fotos de imagen y https; rechaza el resto", () => {
    expect(waiterPhotoProblem(PHOTO)).toBeNull();
    expect(waiterPhotoProblem("https://cdn.vimdy.co/a.jpg")).toBeNull();
    expect(waiterPhotoProblem("javascript:alert(1)")).not.toBeNull();
    expect(waiterPhotoProblem("data:text/html;base64,PHNjcmlwdD4=")).not.toBeNull();
    expect(waiterPhotoProblem("data:image/svg+xml;base64,PHN2Zz4=")).not.toBeNull();
    expect(waiterPhotoProblem("http://inseguro.test/a.jpg")).not.toBeNull();
    expect(waiterPhotoProblem("")).not.toBeNull();
    expect(waiterPhotoProblem("data:image/png;base64," + "A".repeat(400_000))).not.toBeNull();
  });
});

describe("WaiterEngine", () => {
  let repo: InMemoryRepository<Waiter>;
  let engine: WaiterEngine;

  beforeEach(() => {
    repo = new InMemoryRepository<Waiter>("waiter");
    engine = new WaiterEngine(repo);
  });

  it("crea un mesero activo con el nombre limpio y su foto", async () => {
    const waiter = await engine.create({ name: "  Ana   María ", photoUrl: PHOTO });
    expect(waiter.name).toBe("Ana María");
    expect(waiter.active).toBe(true);
    expect(waiter.photoUrl).toBe(PHOTO);
    expect((await engine.listAll()).map((w) => w.name)).toEqual(["Ana María"]);
  });

  it("exige nombre y respeta el máximo", async () => {
    await expect(engine.create({ name: "   " })).rejects.toThrow("WAITER_NAME_REQUIRED");
    await expect(engine.create({ name: "x".repeat(WAITER_NAME_MAX_LENGTH + 1) })).rejects.toThrow(
      "WAITER_NAME_TOO_LONG"
    );
    await expect(engine.create({ name: "x".repeat(WAITER_NAME_MAX_LENGTH) })).resolves.toBeTruthy();
  });

  it("no permite dos meseros con el mismo nombre (sin tildes ni mayúsculas), ni siquiera inactivos", async () => {
    const jose = await engine.create({ name: "José" });
    await expect(engine.create({ name: "jose" })).rejects.toThrow(/^WAITER_NAME_DUPLICATE/);

    await engine.setActive(jose.id, false);
    await expect(engine.create({ name: "JOSE " })).rejects.toThrow(/^WAITER_NAME_DUPLICATE/);
  });

  it("el error de nombre repetido se traduce a un mensaje legible", async () => {
    await engine.create({ name: "Ana" });
    const error = await engine.create({ name: "ana" }).catch((e: unknown) => e);
    const message = translateBusinessError(error);
    expect(message).toContain("Ya hay un mesero");
    expect(message).not.toMatch(/WAITER_/);
  });

  it("renombra, permite cambiar solo mayúsculas del mismo mesero y bloquea nombres de otro", async () => {
    const ana = await engine.create({ name: "Ana" });
    await engine.create({ name: "Beto" });

    expect((await engine.rename(ana.id, "ANA")).name).toBe("ANA");
    await expect(engine.rename(ana.id, "beto")).rejects.toThrow(/^WAITER_NAME_DUPLICATE/);
    await expect(engine.rename(ana.id, "  ")).rejects.toThrow("WAITER_NAME_REQUIRED");
    await expect(engine.rename("no-existe", "Carlos")).rejects.toThrow("WAITER_NOT_FOUND");
  });

  it("agrega, cambia y quita la foto", async () => {
    const ana = await engine.create({ name: "Ana" });
    expect(ana.photoUrl).toBeUndefined();

    const withPhoto = await engine.updatePhoto(ana.id, PHOTO);
    expect(withPhoto.photoUrl).toBe(PHOTO);

    const without = await engine.updatePhoto(ana.id, undefined);
    expect("photoUrl" in without).toBe(false);
    expect((await engine.getById(ana.id))?.photoUrl).toBeUndefined();
  });

  it("rechaza fotos que no son imagen", async () => {
    const ana = await engine.create({ name: "Ana" });
    await expect(engine.updatePhoto(ana.id, "javascript:alert(1)")).rejects.toThrow(/^WAITER_PHOTO_INVALID/);
    await expect(engine.create({ name: "Beto", photoUrl: "data:text/html;base64,AAAA" })).rejects.toThrow(
      /^WAITER_PHOTO_INVALID/
    );
    expect((await engine.listAll()).map((w) => w.name)).toEqual(["Ana"]); // Beto no se creó
  });

  it("listActive muestra solo activos y en orden alfabético", async () => {
    const zoe = await engine.create({ name: "Zoe" });
    await engine.create({ name: "Ana" });
    await engine.setActive(zoe.id, false);

    expect((await engine.listActive()).map((w) => w.name)).toEqual(["Ana"]);
    expect((await engine.listAll()).map((w) => w.name)).toEqual(["Ana", "Zoe"]);
  });

  it("borra de verdad y falla si ya no existe", async () => {
    const ana = await engine.create({ name: "Ana" });
    await engine.delete(ana.id);
    expect(await engine.getById(ana.id)).toBeNull();
    await expect(engine.delete(ana.id)).rejects.toThrow("WAITER_NOT_FOUND");
  });
});