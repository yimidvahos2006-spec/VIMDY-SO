import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { translateBusinessError } from "../../src/core/errors/translateBusinessError";

const EXPECTED =
  "El negocio debe tener al menos un administrador activo. Asigna el rol de Administrador a otra persona antes de quitar o cambiar a este.";

describe("candado de último administrador — mensaje para el usuario", () => {
  it("traduce el error cuando el código viene al inicio", () => {
    const error = new Error("LAST_ADMIN_PROTECTED: el negocio debe conservar al menos un administrador activo.");
    expect(translateBusinessError(error)).toBe(EXPECTED);
  });

  it("lo traduce aunque el repositorio lo envuelva (como llega de Postgres)", () => {
    const error = new Error("SUPABASE_UPDATE_FAILED (app_users): LAST_ADMIN_PROTECTED: el negocio debe conservar al menos un administrador activo.");
    expect(translateBusinessError(error)).toBe(EXPECTED);
  });

  it("también cuando el rechazo viene de business_members", () => {
    const error = new Error("SUPABASE_DELETE_FAILED (business_members): LAST_ADMIN_PROTECTED: ...");
    expect(translateBusinessError(error)).toBe(EXPECTED);
  });

  it("nunca muestra el código técnico ni inglés al usuario", () => {
    const message = translateBusinessError(new Error("SUPABASE_UPDATE_FAILED (app_users): LAST_ADMIN_PROTECTED: x"));
    expect(message).not.toMatch(/LAST_ADMIN_PROTECTED|SUPABASE/);
  });

  it("no confunde otros errores con el candado", () => {
    expect(translateBusinessError(new Error("EMAIL_ALREADY_IN_USE: x"))).not.toBe(EXPECTED);
    expect(translateBusinessError(new Error("algo raro"), "Intenta de nuevo.")).not.toBe(EXPECTED);
  });
});

/**
 * RESPALDO ESTÁTICO. Estas pruebas NO ejecutan la base de datos: solo evitan que
 * alguien borre el candado de la migración sin darse cuenta. El comportamiento
 * real se prueba con supabase/tests/team_admin_guard.test.sql contra Postgres.
 */
describe("candado de último administrador — respaldo en la migración", () => {
  const migration = readFileSync(
    resolve(__dirname, "../../supabase/migrations/20261118000000_team_admin_only_and_last_admin_guard.sql"),
    "utf8",
  );
  const sqlTest = readFileSync(resolve(__dirname, "../../supabase/tests/team_admin_guard.test.sql"), "utf8");

  it("protege business_members y app_users antes de actualizar o borrar", () => {
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON public\.business_members/);
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON public\.app_users/);
  });

  it("rechaza con el mismo código que el cliente sabe traducir", () => {
    const raises = migration.match(/RAISE EXCEPTION 'LAST_ADMIN_PROTECTED:/g) ?? [];
    expect(raises.length).toBeGreaterThanOrEqual(2);
  });

  it("las funciones del candado no se pueden llamar desde el cliente", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.guard_last_admin_business_members\(\) FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.guard_last_admin_app_users\(\) FROM PUBLIC, anon, authenticated/);
  });

  it("existe la prueba SQL que verifica el comportamiento real", () => {
    expect(sqlTest).toMatch(/LAST_ADMIN_PROTECTED/);
  });
});