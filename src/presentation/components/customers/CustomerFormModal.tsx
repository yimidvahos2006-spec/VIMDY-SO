import React, { useState } from "react";
import { X } from "lucide-react";

import { Customer } from "../../../core/entities/Entities";

export function CustomerFormModal({
  customer,
  onClose,
  onSubmit
}: {
  customer: Customer | null;
  onClose: () => void;
  onSubmit: (values: {
    name: string;
    email?: string;
    phone?: string;
    documentType?: Customer["documentType"];
    documentNumber?: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [documentType, setDocumentType] = useState<Customer["documentType"]>(customer?.documentType ?? "CC");
  const [documentNumber, setDocumentNumber] = useState(customer?.documentNumber ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({ name, email, phone, documentType, documentNumber });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-vimdy-surface border border-slate-700 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-bold">
            {customer ? "Editar cliente" : "Nuevo cliente"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400">Nombre</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre del cliente"
              className="mt-1 w-full h-11 rounded-xl bg-slate-800 border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Teléfono (opcional)</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="300 000 0000"
              className="mt-1 w-full h-11 rounded-xl bg-slate-800 border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Correo (opcional)</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@correo.com"
              className="mt-1 w-full h-11 rounded-xl bg-slate-800 border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500"
            />
          </div>
          <div className="grid grid-cols-[110px_1fr] gap-2">
            <div>
              <label className="text-xs text-slate-400">Documento</label>
              <select
                value={documentType ?? "CC"}
                onChange={(e) => setDocumentType(e.target.value as Customer["documentType"])}
                className="mt-1 w-full h-11 rounded-xl bg-slate-800 border border-slate-700 px-2 text-white text-sm outline-none focus:border-cyan-500"
              >
                <option value="CC">CC</option>
                <option value="CE">CE</option>
                <option value="NIT">NIT</option>
                <option value="PASSPORT">Pasaporte</option>
                <option value="OTHER">Otro</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400">Número fiscal (opcional)</label>
              <input
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                placeholder="Ej. 123456789"
                inputMode="numeric"
                className="mt-1 w-full h-11 rounded-xl bg-slate-800 border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 h-11 rounded-xl bg-slate-800 border border-slate-700 text-white font-semibold text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={!name.trim() || saving}
              className="flex-1 h-11 rounded-xl bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-slate-950 font-bold text-sm"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}