import { useState } from "react";
import { VimdyModal } from "../ui/VimdyModal";
import { VimdyInput } from "../ui/VimdyInput";
import { VimdySelect } from "../ui/VimdySelect";
import { VimdyButton } from "../ui/VimdyButton";
import { MoneyInput } from "../ui/MoneyInput";
import { parseMoneyInput } from "../../../core/utils/parseMoneyInput";

export interface QuickProductData {
  name: string;
  categoryId: string;
  cost: number;
  price: number;
  stock: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  categories: { id: string; name: string }[];
  /** Debe devolver true si se guardó bien (el padre cierra el modal). */
  onSave: (data: QuickProductData) => Promise<boolean>;
  /** Mensaje de error del guardado (ej. "Ya existe un producto con ese nombre"). */
  error?: string | null;
}

const moneyClass =
  "w-full rounded-vimdy-sm border border-vimdy-border bg-vimdy-surface px-vimdy-md py-vimdy-sm text-vimdy-body text-vimdy-text placeholder:text-vimdy-text-tertiary outline-none transition-colors duration-vimdy-fast focus:border-vimdy-accent focus:ring-2 focus:ring-vimdy-accent/20";

export function NewProductModal({ open, onClose, categories, onSave, error }: Props) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const costNum = parseMoneyInput(cost) || 0;
  const priceNum = parseMoneyInput(price) || 0;
  const profit = priceNum - costNum;
  const canSave = name.trim().length > 0 && categoryId !== "" && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setAttempted(true);
    try {
      await onSave({
        name: name.trim(),
        categoryId,
        cost: costNum,
        price: priceNum,
        stock: Math.max(0, Number(stock) || 0)
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <VimdyModal open={open} onClose={onClose} title="Producto rápido" size="sm">
      <div className="flex flex-col gap-vimdy-md">
        <VimdyInput label="Nombre" placeholder="Ej: Gaseosa 400 ml" value={name} onChange={(e) => setName(e.target.value)} />

        <VimdySelect label="Categoría" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Selecciona una categoría</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </VimdySelect>

        <div className="grid grid-cols-2 gap-vimdy-md">
          <div className="flex flex-col gap-1.5">
            <label className="vimdy-small text-vimdy-text-secondary">Costo</label>
            <MoneyInput className={moneyClass} placeholder="0" value={cost} onValueChange={setCost} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="vimdy-small text-vimdy-text-secondary">Precio</label>
            <MoneyInput className={moneyClass} placeholder="0" value={price} onValueChange={setPrice} />
          </div>
        </div>

        <span className={`vimdy-small ${profit >= 0 ? "text-vimdy-success" : "text-vimdy-danger"}`}>
          Ganancia: ${profit.toLocaleString("es-CO")}
        </span>

        <VimdyInput label="Stock inicial" type="number" min={0} placeholder="0" value={stock} onChange={(e) => setStock(e.target.value)} />

        {attempted && error && (
          <span className="vimdy-small text-vimdy-danger">{error}</span>
        )}

        <VimdyButton fullWidth disabled={!canSave} loading={saving} onClick={handleSave}>
          Guardar Producto
        </VimdyButton>
      </div>
    </VimdyModal>
  );
}