import { Supplier } from "../../../core/entities/Entities";
import { FormSectionCard } from "./FormSectionCard";

interface AdvancedSectionProps {
  defaultOpen: boolean;

  // Código de barras
  barcode: string;
  onBarcodeChange: (value: string) => void;

  // Código interno (SKU)
  sku: string;
  onSkuChange: (value: string) => void;

  // Proveedor principal
  suppliers: Supplier[];
  loadingOptions: boolean;
  supplierId: string;
  onSupplierIdChange: (value: string) => void;

  // Proveedor alternativo
  alternateSupplierId: string;
  onAlternateSupplierIdChange: (value: string) => void;
}

/**
 * PASO 1 (extracción de ProductFormModal — "Opciones avanzadas"): toda la
 * tarjeta ⚙️ Opciones avanzadas del formulario de producto vive acá y en
 * ningún otro lado. Código de barras, código interno (SKU), proveedor
 * principal y proveedor alternativo. Nada más.
 *
 * Es un componente controlado: no guarda su propio estado de negocio (el
 * barcode/sku/supplierId/alternateSupplierId siguen viviendo en
 * ProductFormModal, porque los usa también fuera de esta tarjeta -- ej.
 * handleSave). Esto lo hace fácil de probar sin tener que renderizar el
 * modal completo.
 *
 * `defaultOpen` sigue calculándose en ProductFormModal (`showAdvancedDefault`):
 * depende de si el producto es Inventario, o si ya trae alguno de estos
 * datos cargados al editar -- ninguna de esas dos cosas es responsabilidad
 * de esta tarjeta.
 */
export function AdvancedSection({
  defaultOpen,
  barcode,
  onBarcodeChange,
  sku,
  onSkuChange,
  suppliers,
  loadingOptions,
  supplierId,
  onSupplierIdChange,
  alternateSupplierId,
  onAlternateSupplierIdChange
}: AdvancedSectionProps) {
  return (
    <FormSectionCard
      icon="⚙️"
      title="Opciones avanzadas"
      subtitle="Código de barras, código interno para tus reportes y de dónde compras este producto. Solo si ya manejas esta información."
      defaultOpen={defaultOpen}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Código de barras</label>
          <input
            value={barcode}
            onChange={(e) => onBarcodeChange(e.target.value)}
            placeholder="Ej: 7701234567890"
            className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
          />
        </div>

        <div>
          <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">
            Código interno <span className="text-vimdy-text-tertiary font-normal">(SKU)</span>
          </label>
          <input
            value={sku}
            onChange={(e) => onSkuChange(e.target.value)}
            placeholder="Ej: HAM-001"
            className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Proveedor principal</label>
          <select
            value={supplierId}
            onChange={(e) => {
              onSupplierIdChange(e.target.value);
              if (e.target.value && e.target.value === alternateSupplierId) {
                onAlternateSupplierIdChange("");
              }
            }}
            disabled={loadingOptions}
            className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
          >
            <option value="">Sin proveedor</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">
            Proveedor alternativo
            <span className="text-vimdy-text-tertiary font-normal"> (opcional)</span>
          </label>
          <select
            value={alternateSupplierId}
            onChange={(e) => onAlternateSupplierIdChange(e.target.value)}
            disabled={loadingOptions}
            className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
          >
            <option value="">Sin proveedor alternativo</option>
            {suppliers
              .filter((s) => s.id !== supplierId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
      </div>
    </FormSectionCard>
  );
}