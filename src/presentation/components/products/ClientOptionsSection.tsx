import { Plus } from "lucide-react";
import { VimdyButton } from "../ui/VimdyButton";
import { Product } from "../../../core/entities/Entities";
import { FormSectionCard } from "./FormSectionCard";
import { PresentationEditor, PresentationRow } from "./PresentationEditor";
import { ExtraEditor, ExtraRow } from "./ExtraEditor";

interface ClientOptionsSectionProps {
  defaultOpen: boolean;

  // Presentaciones (tamaños)
  sizeRows: PresentationRow[];
  onAddSizeRow: () => void;
  onUpdateSizeRow: (rowId: string, field: "name" | "priceDelta", value: string) => void;
  onRemoveSizeRow: (rowId: string) => void;
  onAddSizeRecipeRow: (sizeRowId: string) => void;
  onUpdateSizeRecipeRow: (
    sizeRowId: string,
    recipeRowId: string,
    field: "productId" | "quantity",
    value: string
  ) => void;
  onRemoveSizeRecipeRow: (sizeRowId: string, recipeRowId: string) => void;

  // Extras
  extraRows: ExtraRow[];
  onAddExtraRow: () => void;
  onUpdateExtraRow: (rowId: string, field: "name" | "priceDelta", value: string) => void;
  onRemoveExtraRow: (rowId: string) => void;
  onAddExtraRecipeRow: (extraRowId: string) => void;
  onUpdateExtraRecipeRow: (
    extraRowId: string,
    recipeRowId: string,
    field: "productId" | "quantity",
    value: string
  ) => void;
  onRemoveExtraRecipeRow: (extraRowId: string, recipeRowId: string) => void;

  // Compartido entre ambos editores
  money: (value: number) => string;
  ingredientOptions: Product[];
}

/**
 * PASO 1 (extracción de ProductFormModal — "Opciones del cliente"): toda la
 * tarjeta 🍔 Opciones del cliente del formulario de producto vive acá y en
 * ningún otro lado. Envuelve `PresentationEditor` (tamaños) y `ExtraEditor`
 * (extras), más el estado vacío que se muestra cuando el producto todavía
 * no tiene ninguno de los dos.
 *
 * Es un componente controlado: sizeRows/extraRows y todos sus handlers
 * siguen viviendo en ProductFormModal (los necesita también handleSave).
 * `defaultOpen` sigue calculándose ahí -- depende de si el producto que se
 * está editando ya trae tamaños o extras cargados, algo que esta tarjeta
 * no tiene por qué saber calcular.
 */
export function ClientOptionsSection({
  defaultOpen,
  sizeRows,
  onAddSizeRow,
  onUpdateSizeRow,
  onRemoveSizeRow,
  onAddSizeRecipeRow,
  onUpdateSizeRecipeRow,
  onRemoveSizeRecipeRow,
  extraRows,
  onAddExtraRow,
  onUpdateExtraRow,
  onRemoveExtraRow,
  onAddExtraRecipeRow,
  onUpdateExtraRecipeRow,
  onRemoveExtraRecipeRow,
  money,
  ingredientOptions
}: ClientOptionsSectionProps) {
  return (
    <FormSectionCard
      icon="🍔"
      title="Opciones del cliente"
      subtitle="Tamanos y extras que el cliente puede elegir. Ajustan el precio base del producto."
      defaultOpen={defaultOpen}
    >
      {sizeRows.length === 0 && extraRows.length === 0 ? (
        /* FASE 2 / PASO 5 (tabla v1.1, tarjeta 7 "🍕 Presentaciones y
           extras"): sin tamaños ni extras, no tiene sentido mostrar los
           dos editores completos (cada uno con su propio label y su
           botón chiquito "Agregar...") -- un mensaje claro + dos botones
           grandes es más fácil de reconocer de un vistazo que el
           formulario vacío de siempre. */
        <div className="text-center py-6 space-y-4">
          <p className="text-vimdy-text-tertiary text-sm">
            Este producto no tiene presentaciones ni extras.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <VimdyButton type="button" onClick={onAddSizeRow} variant="secondary" icon={<Plus size={16} />} fullWidth>
              Agregar presentación
            </VimdyButton>
            <VimdyButton type="button" onClick={onAddExtraRow} variant="secondary" icon={<Plus size={16} />} fullWidth>
              Agregar extra
            </VimdyButton>
          </div>
        </div>
      ) : (
        <>
          <PresentationEditor
            rows={sizeRows}
            onAdd={onAddSizeRow}
            onUpdate={onUpdateSizeRow}
            onRemove={onRemoveSizeRow}
            money={money}
            ingredientOptions={ingredientOptions}
            onAddRecipeRow={onAddSizeRecipeRow}
            onUpdateRecipeRow={onUpdateSizeRecipeRow}
            onRemoveRecipeRow={onRemoveSizeRecipeRow}
          />

          <ExtraEditor
            rows={extraRows}
            onAdd={onAddExtraRow}
            onUpdate={onUpdateExtraRow}
            onRemove={onRemoveExtraRow}
            money={money}
            ingredientOptions={ingredientOptions}
            onAddRecipeRow={onAddExtraRecipeRow}
            onUpdateRecipeRow={onUpdateExtraRecipeRow}
            onRemoveRecipeRow={onRemoveExtraRecipeRow}
          />

          <p className="text-vimdy-warning/80 text-xs">
            Nota: por ahora estas opciones quedan guardadas en el producto, pero Caja todavía no
            muestra un selector para elegirlas al vender.
          </p>
        </>
      )}
    </FormSectionCard>
  );
}