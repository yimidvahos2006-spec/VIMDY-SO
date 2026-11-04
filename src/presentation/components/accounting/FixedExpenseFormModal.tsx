import { useRef, useState, type FormEvent } from "react";

import {
  FIXED_EXPENSE_CATEGORIES,
  FIXED_EXPENSE_CATEGORY_LABELS,
  type FixedExpense,
  type FixedExpenseCategory
} from "../../../core/types/fixedExpense";
import { getBusinessTodayIsoDate, isIsoDateString } from "../../../core/utils/isoDate";
import { parseMoneyInput } from "../../../core/utils/parseMoneyInput";
import { toast } from "../../../core/store/toastStore";
import { createFixedExpense } from "../../../infrastructure/supabase/fixedExpenseService";
import { MoneyInput } from "../ui/MoneyInput";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";
import { VimdyModal } from "../ui/VimdyModal";
import { VimdySelect } from "../ui/VimdySelect";
import { CATEGORY_STYLE } from "./fixedExpenseStyles";

const MAX_DESCRIPTION = 200;

export interface ExpenseBranchOption {
  id: string;
  name: string;
}

interface FixedExpenseFormModalProps {
  open: boolean;
  onClose: () => void;
  businessId: string;
  /** Sucursales activas. Con 0 o 1 sucursal no se muestra el selector. */
  branches: readonly ExpenseBranchOption[];
  /** Categoría preseleccionada (p. ej. la que está filtrada en la vista). */
  defaultCategory?: FixedExpenseCategory;
  onSaved: (expense: FixedExpense) => void;
}

/** "+ Registrar gasto": 4 campos, Enter guarda, Escape cierra. */
export function FixedExpenseFormModal({ open, onClose, ...rest }: FixedExpenseFormModalProps) {
  const [saving, setSaving] = useState(false);

  // No se puede cerrar mientras se guarda: evita perder el resultado del guardado.
  const handleClose = () => {
    if (!saving) onClose();
  };

  return (
    <VimdyModal open={open} onClose={handleClose} title="Registrar gasto" size="sm">
      {/* Se monta de nuevo cada vez que se abre: el formulario siempre arranca limpio. */}
      <FormBody {...rest} saving={saving} setSaving={setSaving} onCancel={handleClose} onClose={onClose} />
    </VimdyModal>
  );
}

function FormBody({
  businessId,
  branches,
  defaultCategory,
  onSaved,
  onClose,
  onCancel,
  saving,
  setSaving
}: Omit<FixedExpenseFormModalProps, "open"> & {
  onCancel: () => void;
  saving: boolean;
  setSaving: (value: boolean) => void;
}) {
  const [category, setCategory] = useState<FixedExpenseCategory>(defaultCategory ?? "arriendo");
  const [amountText, setAmountText] = useState("");
  const [date, setDate] = useState<string>(() => getBusinessTodayIsoDate());
  const [description, setDescription] = useState("");
  const [branchId, setBranchId] = useState(""); // "" = todo el negocio
  const [errors, setErrors] = useState<{ amount?: string; date?: string; form?: string }>({});
  const submitting = useRef(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;

    const amount = parseMoneyInput(amountText);
    const nextErrors: typeof errors = {};
    if (!Number.isFinite(amount) || amount <= 0) nextErrors.amount = "Escribe un valor mayor que cero.";
    if (!isIsoDateString(date)) nextErrors.date = "Elige una fecha válida.";
    if (nextErrors.amount || nextErrors.date) {
      setErrors(nextErrors);
      return;
    }

    submitting.current = true;
    setSaving(true);
    setErrors({});
    try {
      const saved = await createFixedExpense(businessId, {
        category,
        amount,
        expenseDate: date,
        description,
        branchId: branchId || null
      });
      toast.success("Gasto registrado.");
      onSaved(saved);
      onClose();
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : "No se pudo guardar el gasto." });
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      {/* Categoría: un toque, sin desplegable */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="vimdy-small text-vimdy-text-secondary mb-1.5">Categoría</legend>
        <div role="radiogroup" aria-label="Categoría del gasto" className="flex flex-wrap gap-2">
          {FIXED_EXPENSE_CATEGORIES.map((value) => {
            const selected = value === category;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={saving}
                onClick={() => setCategory(value)}
                className={`inline-flex items-center gap-2 h-10 px-3.5 rounded-vimdy-md border text-sm font-semibold transition disabled:opacity-50 focus-visible:outline-none focus-visible:shadow-vimdy-accent ${
                  selected
                    ? "border-vimdy-accent bg-vimdy-accent/10 text-vimdy-text"
                    : "border-vimdy-border bg-vimdy-surface text-vimdy-text-secondary hover:border-vimdy-text-tertiary hover:text-vimdy-text"
                }`}
              >
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${CATEGORY_STYLE[value].dot}`} />
                {FIXED_EXPENSE_CATEGORY_LABELS[value]}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Monto */}
      <div className="flex w-full flex-col gap-1.5">
        <label htmlFor="fixed-expense-amount" className="vimdy-small text-vimdy-text-secondary">
          Valor
        </label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-vimdy-md top-1/2 -translate-y-1/2 text-vimdy-text-tertiary"
          >
            $
          </span>
          <MoneyInput
            id="fixed-expense-amount"
            autoFocus
            autoComplete="off"
            placeholder="0"
            disabled={saving}
            value={amountText}
            onValueChange={(next) => {
              setAmountText(next);
              if (errors.amount) setErrors((prev) => ({ ...prev, amount: undefined }));
            }}
            aria-invalid={!!errors.amount}
            aria-describedby={errors.amount ? "fixed-expense-amount-error" : undefined}
            className={`w-full rounded-vimdy-sm border bg-vimdy-surface pl-9 pr-vimdy-md py-vimdy-sm text-vimdy-body font-semibold tabular-nums text-vimdy-text placeholder:text-vimdy-text-tertiary outline-none transition-colors duration-vimdy-fast disabled:opacity-50 ${
              errors.amount
                ? "border-vimdy-danger focus:border-vimdy-danger focus:ring-2 focus:ring-vimdy-danger/20"
                : "border-vimdy-border focus:border-vimdy-accent focus:ring-2 focus:ring-vimdy-accent/20"
            }`}
          />
        </div>
        {errors.amount && (
          <span id="fixed-expense-amount-error" className="vimdy-micro normal-case text-vimdy-danger">
            {errors.amount}
          </span>
        )}
      </div>

      {/* Fecha (+ sucursal si el negocio tiene varias) */}
      <div className={`grid gap-4 ${branches.length > 1 ? "sm:grid-cols-2" : ""}`}>
        <VimdyInput
          type="date"
          label="Fecha"
          value={date}
          disabled={saving}
          error={errors.date}
          onChange={(e) => {
            setDate(e.target.value);
            if (errors.date) setErrors((prev) => ({ ...prev, date: undefined }));
          }}
        />
        {branches.length > 1 && (
          <VimdySelect
            label="Sucursal"
            value={branchId}
            disabled={saving}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">Todo el negocio</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </VimdySelect>
        )}
      </div>

      {/* Descripción */}
      <VimdyInput
        label="Descripción (opcional)"
        placeholder="Ej. Arriendo del local, factura de luz…"
        maxLength={MAX_DESCRIPTION}
        autoComplete="off"
        disabled={saving}
        value={description}
        hint={description.length >= MAX_DESCRIPTION - 40 ? `${description.length}/${MAX_DESCRIPTION}` : undefined}
        onChange={(e) => setDescription(e.target.value)}
      />

      {errors.form && (
        <p
          role="alert"
          className="rounded-vimdy-sm border border-vimdy-danger/40 bg-vimdy-danger-bg px-3 py-2 text-sm text-vimdy-danger"
        >
          {errors.form}
        </p>
      )}

      <div className="flex items-center justify-end gap-3 pt-1">
        <VimdyButton variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </VimdyButton>
        <VimdyButton type="submit" loading={saving}>
          Guardar gasto
        </VimdyButton>
      </div>
    </form>
  );
}