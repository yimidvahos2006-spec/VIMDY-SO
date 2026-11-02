import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Los modales de Equipo deben seguir siendo diálogos accesibles y cerrar con
 * Escape. Es una comprobación de código fuente (no hay navegador en las pruebas):
 * evita que un cambio futuro quite esas garantías sin que nadie lo note.
 */
const FILES = {
  "Agregar persona (SettingsDashboard.tsx)": "../../src/presentation/components/settings/SettingsDashboard.tsx",
  "Permisos del rol (PermissionEditor.tsx)": "../../src/presentation/components/settings/PermissionEditor.tsx",
} as const;

describe.each(Object.entries(FILES))("modal %s", (_name, relative) => {
  const source = readFileSync(resolve(__dirname, relative), "utf8");

  it("es un diálogo modal con título asociado", () => {
    expect(source).toMatch(/role="dialog"/);
    expect(source).toMatch(/aria-modal="true"/);
    expect(source).toMatch(/aria-labelledby=\{titleId\}/);
    expect(source).toMatch(/<h3 id=\{titleId\}/);
  });

  it("se cierra con Escape, pero no mientras se está guardando", () => {
    expect(source).toMatch(/useEscapeToClose\(onClose, !saving\)/);
  });
});