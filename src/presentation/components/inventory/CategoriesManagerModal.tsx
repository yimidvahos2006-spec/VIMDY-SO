import { useState } from "react";
import { Check, Loader2, Pencil, Plus, Tag, Trash2, X } from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { useCategories } from "../../../hooks/useCategories";

interface CategoriesManagerModalProps {
  onClose: () => void;
}

/**
 * Administrador de categorías del negocio (Inventario → "Categorías").
 * Permite ver, crear, renombrar y eliminar categorías. Una categoría con
 * productos NO se puede eliminar (el motor lo bloquea con CATEGORY_IN_USE).
 */
export function CategoriesManagerModal({ onClose }: CategoriesManagerModalProps) {
  const { categories, loading, error, createCategory, updateCategory, deleteCategory } =
    useCategories();

  const [newName, setNewName] = useState("");
  const [newKitchen, setNewKitchen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name));

  async function handleCreate() {
    if (busy || !newName.trim()) return;
    setBusy(true);
    const created = await createCategory({
      name: newName.trim(),
      requiresKitchenByDefault: newKitchen
    });
    setBusy(false);
    if (created) {
      setNewName("");
      setNewKitchen(false);
    }
  }

  async function handleRename(id: string) {
    if (busy || !editName.trim()) return;
    setBusy(true);
    const updated = await updateCategory(id, { name: editName.trim() });
    setBusy(false);
    if (updated) {
      setEditingId(null);
      setEditName("");
    }
  }

  async function handleToggleKitchen(id: string, current: boolean) {
    if (busy) return;
    setBusy(true);
    await updateCategory(id, { requiresKitchenByDefault: !current });
    setBusy(false);
  }

  async function handleDelete(id: string) {
    if (busy) return;
    setBusy(true);
    await deleteCategory(id);
    setBusy(false);
    setConfirmDeleteId(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Tag size={20} className="text-vimdy-accent" />
            <h2 className="text-xl font-bold text-vimdy-text">Categorías</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1 rounded-md text-vimdy-text-secondary hover:bg-vimdy-surface-hover"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-vimdy-text-secondary mb-4">
          Organiza tus productos por categoría. Así en Caja los encuentras más rápido.
        </p>

        <div className="rounded-vimdy-md border border-vimdy-border bg-vimdy-background p-3 mb-5">
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
              placeholder="Nombre de la nueva categoría"
              disabled={busy}
              className="flex-1 h-10 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
            />
            <VimdyButton
              size="sm"
              onClick={() => void handleCreate()}
              disabled={busy || !newName.trim()}
              icon={<Plus size={16} />}
            >
              Agregar
            </VimdyButton>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-vimdy-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={newKitchen}
              onChange={(e) => setNewKitchen(e.target.checked)}
              className="rounded border-vimdy-border"
            />
            Sus productos se preparan en cocina
          </label>
        </div>

        {error && (
          <div className="mb-4 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-3 py-2">
            {error}
          </div>
        )}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-vimdy-text-secondary">
            <Loader2 size={14} className="animate-spin" /> Cargando categorías...
          </p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-vimdy-text-secondary text-center py-6">
            Todavía no tienes categorías. Escribe un nombre arriba y toca "Agregar".
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((category) => {
              const kitchen = category.requiresKitchenByDefault !== false;
              const isEditing = editingId === category.id;
              const isConfirming = confirmDeleteId === category.id;

              return (
                <li
                  key={category.id}
                  className="rounded-vimdy-md border border-vimdy-border bg-vimdy-background px-3 py-2.5"
                >
                  {isEditing ? (
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleRename(category.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        disabled={busy}
                        className="flex-1 h-9 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
                      />
                      <button
                        type="button"
                        onClick={() => void handleRename(category.id)}
                        disabled={busy || !editName.trim()}
                        aria-label="Guardar nombre"
                        className="p-2 rounded-md text-vimdy-success hover:bg-vimdy-surface-hover disabled:opacity-50"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        aria-label="Cancelar"
                        className="p-2 rounded-md text-vimdy-text-secondary hover:bg-vimdy-surface-hover"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : isConfirming ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-vimdy-text">
                        ¿Eliminar "{category.name}"?
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleDelete(category.id)}
                          disabled={busy}
                          className="h-8 px-3 rounded-vimdy-md border border-vimdy-danger/40 text-vimdy-danger text-sm hover:bg-vimdy-danger/10 disabled:opacity-50"
                        >
                          Sí, eliminar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="h-8 px-3 rounded-vimdy-md border border-vimdy-border text-vimdy-text-secondary text-sm hover:bg-vimdy-surface-hover"
                        >
                          No
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-vimdy-text truncate">
                          {category.name}
                        </p>
                        <label className="mt-0.5 flex items-center gap-1.5 text-xs text-vimdy-text-tertiary cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={kitchen}
                            disabled={busy}
                            onChange={() => void handleToggleKitchen(category.id, kitchen)}
                            className="rounded border-vimdy-border"
                          />
                          Se prepara en cocina
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(category.id);
                          setEditName(category.name);
                          setConfirmDeleteId(null);
                        }}
                        aria-label={`Renombrar ${category.name}`}
                        className="p-2 rounded-md text-vimdy-text-secondary hover:bg-vimdy-surface-hover"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(category.id);
                          setEditingId(null);
                        }}
                        aria-label={`Eliminar ${category.name}`}
                        className="p-2 rounded-md text-vimdy-text-secondary hover:text-vimdy-danger hover:bg-vimdy-danger/10"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex justify-end pt-5">
          <VimdyButton variant="ghost" onClick={onClose}>
            Cerrar
          </VimdyButton>
        </div>
      </div>
    </div>
  );
}