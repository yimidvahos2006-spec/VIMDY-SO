/**
 * Limpieza de insumos creados con "ingrediente rápido" dentro del formulario
 * de producto. Si el producto no se guarda, esos insumos quedarían huérfanos.
 * Nunca lanza: un fallo al borrar uno no impide intentar los demás.
 */
export async function discardQuickIngredients(
  createdIds: readonly string[],
  keepIds: ReadonlySet<string>,
  deleteOne: (id: string) => Promise<unknown>
): Promise<number> {
  let processed = 0;
  for (const id of new Set(createdIds)) {
    if (keepIds.has(id)) continue;
    try {
      await deleteOne(id);
      processed += 1;
    } catch {
      /* PRODUCT_IN_USE, ya borrado, sin red...: se deja y se sigue */
    }
  }
  return processed;
}
