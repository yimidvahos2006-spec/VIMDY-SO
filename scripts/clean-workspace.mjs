#!/usr/bin/env node
/**
 * Limpieza del espacio de trabajo de VIMDY OS.
 *
 * Elimina artefactos locales que nunca deben vivir en el repositorio ni en un
 * paquete de release: logs, salidas de build, capturas de pantalla sueltas en
 * la raíz, clones temporales de reparación y carpetas generadas.
 *
 * Uso:
 *   npm run clean          -> simulacro (solo lista lo que se borraría)
 *   npm run clean:apply    -> borra de verdad
 *
 * Nunca toca: src/, supabase/, tests/, public/, docs/, node_modules/, .env*.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const apply = process.argv.includes("--apply");

const rootFiles = [
  "null",
  "out.txt",
  "test-output.txt",
  "console_messages.txt",
  "build.log",
  "build-cmd-output.txt",
  "build-execution.log",
  "build-output.txt",
  "build-status.txt",
  "tsc-exit.txt",
  "tsc-out.txt",
  "tsc-output.txt",
  "vitest-debug.log",
  "demo-fondo-snapshot.yml"
];

const rootDirectories = [
  "%SystemDrive%",
  "caja_repair_temp",
  "vimdy-audit",
  "playwright-screenshots",
  "playwright-report",
  "test-results",
  "coverage",
  "dist",
  ".vite",
  ".release"
];

const rootDirectoryPrefixes = ["vimdy_migration_cleanup_", ".release-"];

const debugScripts = readdirSync(join(root, "scripts", "e2e"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^debug-.*\.mjs$/.test(entry.name))
  .map((entry) => join("scripts", "e2e", entry.name));

const rootImages = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(png|jpe?g|gif|webp)$/i.test(entry.name))
  .map((entry) => entry.name);

const prefixedDirectories = readdirSync(root, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && rootDirectoryPrefixes.some((prefix) => entry.name.startsWith(prefix))
  )
  .map((entry) => entry.name);

const targets = [
  ...new Set([...rootFiles, ...rootDirectories, ...prefixedDirectories, ...rootImages, ...debugScripts])
].filter((relativePath) => existsSync(join(root, relativePath)));

if (targets.length === 0) {
  process.stdout.write("Nada que limpiar.\n");
  process.exit(0);
}

for (const relativePath of targets) {
  const absolutePath = join(root, relativePath);
  const kind = statSync(absolutePath).isDirectory() ? "dir " : "file";
  if (apply) rmSync(absolutePath, { recursive: true, force: true });
  process.stdout.write(`${apply ? "borrado " : "borraría"} ${kind} ${relativePath}\n`);
}

process.stdout.write(
  apply
    ? `\n${targets.length} elementos eliminados.\n`
    : `\n${targets.length} elementos. Ejecuta "npm run clean:apply" para eliminarlos.\n`
);
