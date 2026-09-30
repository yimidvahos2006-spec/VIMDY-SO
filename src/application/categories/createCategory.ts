import { container } from "../../infrastructure/di/CompositionRoot";
import { Category } from "../../core/entities/Entities";

export interface CreateCategoryFromFormInput {
  name: string;
  requiresKitchenByDefault?: boolean;
  printStation?: string;
}

/**
 * PASO 2 (eliminar lógica duplicada de categorías): antes "crear una
 * categoría nueva desde el formulario" -- armar el payload, llamar a
 * `container.categoryEngine.create`, y traducir sus errores a un mensaje
 * que el usuario entienda -- vivía copiado dos veces dentro de
 * InventoryDashboard.tsx: una vez en `ProductFormModal.handleCreateCategory`
 * y otra en `AiImportModal.handleCreateCategory`. Eran casi idénticas
 * (una traía `printStation` y la otra no) pero nada garantizaba que
 * siguieran siéndolo -- el día que alguien agregara un campo, o cambiara
 * un mensaje de error, tenía que acordarse de tocar los dos lugares.
 *
 * Ahora existe UNA sola función. `ProductFormModal` y `AiImportModal`
 * llaman exactamente esta, cada uno con los campos que su formulario
 * conoce (AiImportModal no maneja `printStation`, así que simplemente no
 * lo manda). El resto de la regla de negocio -- qué es un nombre válido,
 * qué significa "duplicado", cómo se ve el mensaje de error -- vive en un
 * solo lugar y solo hay que cambiarlo en un solo lugar.
 *
 * Lanza un Error con el mensaje ya en español, listo para mostrarse tal
 * cual en el campo de error del formulario:
 *
 *   try {
 *     const created = await createCategoryFromForm({ name, requiresKitchenByDefault });
 *     ...
 *   } catch (err: any) {
 *     setCategoryError(err.message);
 *   }
 */
const CATEGORY_ERROR_MESSAGES: Record<string, string> = {
  CATEGORY_NAME_REQUIRED: "Escribe un nombre para la categoría.",
  CATEGORY_NAME_DUPLICATE: "Ya existe una categoría con ese nombre."
};

export async function createCategoryFromForm({
  name,
  requiresKitchenByDefault,
  printStation
}: CreateCategoryFromFormInput): Promise<Category> {
  const trimmed = name.trim();

  if (!trimmed) {
    throw new Error(CATEGORY_ERROR_MESSAGES.CATEGORY_NAME_REQUIRED);
  }

  try {
    return await container.categoryEngine.get().create({
      name: trimmed,
      requiresKitchenByDefault,
      printStation: printStation?.trim() || undefined
    });
  } catch (err: any) {
    throw new Error(CATEGORY_ERROR_MESSAGES[err?.message] ?? "No se pudo crear la categoría.");
  }
}