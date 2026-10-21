import { container } from "../../infrastructure/di/CompositionRoot";
import type { Category } from "../../core/entities/Entities";
import {
  ImportPlan,
  INSUMOS_CATEGORY_NAME,
  normalizeText,
  rowToProductInput,
  rowToUpdatePatch
} from "../../presentation/components/inventory/csvImport";

export interface ImportOutcome {
  created: number;
  updated: number;
  skipped: number;
  failed: Array<{ line: number; name: string; error: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  NOMBRE_DUPLICADO: "Ya existe un producto con ese nombre.",
  PRODUCT_NAME_REQUIRED: "Falta el nombre.",
  PRECIO_INVALIDO: "El precio de venta no es válido.",
  PRODUCT_NOT_FOUND: "El producto ya no existe.",
  INSUFFICIENT_STOCK: "No se pudo registrar el stock inicial.",
  INVENTORY_BATCH_FORBIDDEN: "Tu rol no puede cargar stock inicial."
};

function friendly(message: string): string {
  const code = Object.keys(ERROR_MESSAGES).find((key) => message.includes(key));
  return code ? ERROR_MESSAGES[code] : message || "No se pudo guardar.";
}

async function ensureCategories(plan: ImportPlan): Promise<Map<string, string>> {
  const engine = container.categoryEngine.get();
  const idByKey = new Map<string, string>();
  const key = (name: string, insumo: boolean) => `${insumo ? "i" : "p"}:${normalizeText(name)}`;

  const register = (categories: Category[]) => {
    for (const c of categories) idByKey.set(key(c.name, c.kind === "INSUMO"), c.id);
  };
  register(await engine.listAll());

  for (const missing of plan.missingCategories) {
    if (idByKey.has(key(missing.name, missing.insumo))) continue;
    try {
      const created = await engine.create({
        name: missing.name,
        kind: missing.insumo ? "INSUMO" : undefined,
        requiresKitchenByDefault: false
      });
      idByKey.set(key(created.name, created.kind === "INSUMO"), created.id);
    } catch {
      // Otra pestaña/dispositivo pudo crearla justo antes: se vuelve a leer.
      register(await engine.listAll());
    }
  }
  return idByKey;
}

/**
 * Ejecuta el plan ya revisado por la persona. Las categorías nuevas solo se
 * crean aquí (después de la confirmación en pantalla).
 */
export async function runCsvImport(
  plan: ImportPlan,
  performedBy: string | undefined,
  onProgress?: (done: number, total: number) => void
): Promise<ImportOutcome> {
  const engine = container.inventoryEngine.get();
  const categoryIds = await ensureCategories(plan);
  const idFor = (name: string, insumo: boolean) =>
    categoryIds.get(`${insumo ? "i" : "p"}:${normalizeText(name || (insumo ? INSUMOS_CATEGORY_NAME : ""))}`);

  const outcome: ImportOutcome = { created: 0, updated: 0, skipped: 0, failed: [] };
  const toCreate = plan.planned.filter((p) => p.action === "create");
  const toUpdate = plan.planned.filter((p) => p.action === "update");
  outcome.skipped = plan.planned.filter((p) => p.action === "skip").length;
  const total = toCreate.length + toUpdate.length;

  const creatable = toCreate.filter((p) => {
    const insumo = p.row.type === "ingrediente";
    if (idFor(p.row.categoryName, insumo)) return true;
    outcome.failed.push({ line: p.row.line, name: p.row.name, error: "No se pudo crear la categoría." });
    return false;
  });

  if (creatable.length > 0) {
    const inputs = creatable.map((p) =>
      rowToProductInput(p.row, idFor(p.row.categoryName, p.row.type === "ingrediente") as string)
    );
    const result = await engine.createProductsBatch(inputs, performedBy, (done) => onProgress?.(done, total));
    outcome.created = result.created.length;
    for (const f of result.failed) {
      outcome.failed.push({ line: creatable[f.index].row.line, name: f.name, error: friendly(f.error) });
    }
  }

  const updatable = toUpdate.filter((p) => {
    if (p.existing && idFor(p.row.categoryName, p.row.type === "ingrediente")) return true;
    outcome.failed.push({ line: p.row.line, name: p.row.name, error: "No se pudo crear la categoría." });
    return false;
  });

  if (updatable.length > 0) {
    const result = await engine.updateProductsBatch(
      updatable.map((p) => ({
        id: (p.existing as NonNullable<typeof p.existing>).id,
        input: rowToUpdatePatch(
          p.row,
          p.existing as NonNullable<typeof p.existing>,
          idFor(p.row.categoryName, p.row.type === "ingrediente") as string
        )
      })),
      (done) => onProgress?.(toCreate.length + done, total)
    );
    outcome.updated = result.updated;
    for (const f of result.failed) {
      outcome.failed.push({ line: updatable[f.index].row.line, name: f.name, error: friendly(f.error) });
    }
  }

  outcome.failed.sort((a, b) => a.line - b.line);
  return outcome;
}