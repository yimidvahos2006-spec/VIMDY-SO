import { Plus, Trash2 } from "lucide-react";
import { VimdyButton } from "../ui/VimdyButton";
import { Product } from "../../../core/entities/Entities";

export interface ExtraRow {
  rowId: string;
  name: string;
  priceDelta: string;
  recipeRows?: ReadonlyArray<{
    recipeRowId: string;
    productId: string;
    quantity: string;
  }>;
}

interface ExtraEditorProps {
  rows: ExtraRow[];
  onAdd: () => void;
  onUpdate: (rowId: string, field: "name" | "priceDelta", value: string) => void;
  onRemove: (rowId: string) => void;
  money: (value: number) => string;
  ingredientOptions: Product[];
  onAddRecipeRow: (rowId: string) => void;
  onUpdateRecipeRow: (
    rowId: string,
    recipeRowId: string,
    field: "productId" | "quantity",
    value: string
  ) => void;
  onRemoveRecipeRow: (rowId: string, recipeRowId: string) => void;
}

export function ExtraEditor({
  rows,
  onAdd,
  onUpdate,
  onRemove,
  money,
  ingredientOptions,
  onAddRecipeRow,
  onUpdateRecipeRow,
  onRemoveRecipeRow,
}: ExtraEditorProps) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-vimdy-text-tertiary text-sm mb-3">Sin extras configurados</p>
        <VimdyButton type="button" onClick={onAdd} variant="secondary" icon={<Plus size={16} />} fullWidth>
          Agregar extra
        </VimdyButton>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.rowId} className="border border-vimdy-border rounded-vimdy-md p-3">
          <div className="flex gap-2 items-center">
            <input
              value={row.name}
              onChange={(e) => onUpdate(row.rowId, "name", e.target.value)}
              placeholder="Nombre (ej. Queso)"
              className="flex-1 h-9 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
            />
            <input
              value={row.priceDelta}
              onChange={(e) => onUpdate(row.rowId, "priceDelta", e.target.value)}
              placeholder="Δ precio"
              className="w-20 h-9 px-2 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
            />
            <VimdyButton type="button" onClick={() => onRemove(row.rowId)} variant="ghost" size="sm">
              <Trash2 size={16} />
            </VimdyButton>
          </div>

          {(row.recipeRows ?? []).length > 0 ? (
            <div className="mt-2 space-y-1">
              {row.recipeRows!.map((recipeRow) => (
                <div key={recipeRow.recipeRowId} className="flex gap-2 items-center text-sm">
                  <select
                    value={recipeRow.productId}
                    onChange={(e) =>
                      onUpdateRecipeRow(row.rowId, recipeRow.recipeRowId, "productId", e.target.value)
                    }
                    className="flex-1 h-8 px-2 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-xs focus:outline-none focus:border-vimdy-accent"
                  >
                    {ingredientOptions.map((ing) => (
                      <option key={ing.id} value={ing.id}>
                        {ing.name}
                      </option>
                    ))}
                  </select>
                  <input
                    value={recipeRow.quantity}
                    onChange={(e) => onUpdateRecipeRow(row.rowId, recipeRow.recipeRowId, "quantity", e.target.value)}
                    placeholder="Cant."
                    className="w-16 h-8 px-2 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-xs focus:outline-none focus:border-vimdy-accent"
                  />
                  <VimdyButton
                    type="button"
                    onClick={() => onRemoveRecipeRow(row.rowId, recipeRow.recipeRowId)}
                    variant="ghost"
                    size="sm"
                  >
                    <Trash2 size={12} />
                  </VimdyButton>
                </div>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onAddRecipeRow(row.rowId)}
              className="text-xs text-vimdy-accent hover:text-vimdy-accent/80 mt-1"
            >
              + Agregar ingrediente
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
