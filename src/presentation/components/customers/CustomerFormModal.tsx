import React, { useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

import { Customer } from "../../../core/entities/Entities";
import {
  CustomerFormValues,
  validateCustomerRequired
} from "../../../core/domain/customers/quickCreate";
import { findCustomerByPhone } from "../../../core/domain/customers/search";

/**
 * CustomerFormModal — alta/edición de cliente desde el panel de Clientes.
 * ---------------------------------------------------------------------------
 * ALTA ULTRARRÁPIDA (cero fricción): lo ÚNICO obligatorio es Nombre y
 * Teléfono, que son los dos campos siempre visibles. Correo, documento, número
 * fiscal, dirección y notas viven en "Más datos (opcional)", plegado por
 * defecto, y NUNCA bloquean el guardado. La regla vive en
 * domain/customers/quickCreate.ts, compartida con el modal de Caja.
 *
 * Teclado: Enter en Nombre pasa a Teléfono; Enter en cualquier campo guarda.
 */

type DocumentType = NonNullable<Customer["documentType"]>;

const inputClass =
  "mt-1 w-full h-11 rounded-xl bg-slate-800 border border-slate-700 px-3 text-white text-sm outline-none focus:border-vimdy-accent";

function hasOptionalData(customer: Customer | null): boolean {
  return Boolean(
    customer?.email?.trim() ||
      customer?.documentNumber?.trim() ||
      customer?.address?.trim() ||
      customer?.notes?.trim()
  );
}

export function CustomerFormModal({
  customer,
  existingCustomers = [],
  error: externalError,
  onClose,
  onSubmit
}: {
  customer: Customer | null;
  /** Clientes ya cargados: sirven para avisar al instante de un teléfono repetido. */
  existingCustomers?: readonly Customer[];
  /** Error del guardado (ej. teléfono repetido en el servidor), mostrado dentro del modal. */
  error?: string | null;
  onClose: () => void;
  onSubmit: (values: CustomerFormValues) => Promise<void>;
}) {
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [documentType, setDocumentType] = useState<DocumentType>(customer?.documentType ?? "CC");
  const [documentNumber, setDocumentNumber] = useState(customer?.documentNumber ?? "");
  const [address, setAddress] = useState(customer?.address ?? "");
  const [notes, setNotes] = useState(customer?.notes ?? "");
  const [showMore, setShowMore] = useState(hasOptionalData(customer));
  const [localError, setLocalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  // Un cliente antiguo que nunca tuvo teléfono se puede seguir editando sin
  // inventar uno; toda alta nueva (y todo cliente que ya tiene teléfono) lo exige.
  const requirePhone = !customer || Boolean(customer.phone?.trim());

  const duplicate = useMemo(
    () => findCustomerByPhone(existingCustomers.filter((c) => c.id !== customer?.id), phone),
    [existingCustomers, customer?.id, phone]
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    const check = validateCustomerRequired({ name, phone }, { requirePhone });
    if (!check.ok) {
      setLocalError(
        check.error === "NAME_REQUIRED"
          ? "Escribe el nombre del cliente."
          : check.error === "PHONE_REQUIRED"
            ? "El teléfono es obligatorio."
            : "El teléfono debe tener al menos 7 dígitos."
      );
      (check.field === "name" ? nameRef : phoneRef).current?.focus();
      return;
    }

    if (duplicate) {
      setLocalError(`Ya existe un cliente con este teléfono: ${duplicate.name}.`);
      phoneRef.current?.focus();
      return;
    }

    setLocalError(null);
    setSaving(true);
    try {
      await onSubmit({ name, phone, email, documentType, documentNumber, address, notes });
    } finally {
      setSaving(false);
    }
  }

  function handleNameKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Enter en Nombre: si falta el teléfono, el cursor pasa a él en vez de
    // intentar guardar y mostrar un error.
    if (event.key === "Enter" && name.trim() && !phone.trim()) {
      event.preventDefault();
      phoneRef.current?.focus();
    }
  }

  const shownError = localError ?? externalError ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        noValidate
        className="w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-2xl bg-vimdy-surface border border-slate-700 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-bold">
            {customer ? "Editar cliente" : "Nuevo cliente"}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="customer-form-name" className="text-xs text-slate-400">
              Nombre <span className="text-vimdy-accent-hover">*</span>
            </label>
            <input
              id="customer-form-name"
              ref={nameRef}
              autoFocus
              autoComplete="off"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setLocalError(null);
              }}
              onKeyDown={handleNameKeyDown}
              placeholder="Nombre del cliente"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="customer-form-phone" className="text-xs text-slate-400">
              Teléfono {requirePhone && <span className="text-vimdy-accent-hover">*</span>}
              {!requirePhone && "(opcional)"}
            </label>
            <input
              id="customer-form-phone"
              ref={phoneRef}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setLocalError(null);
              }}
              placeholder="300 000 0000"
              className={inputClass}
            />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowMore((current) => !current)}
              aria-expanded={showMore}
              className="flex items-center gap-1.5 text-slate-400 text-sm hover:text-white transition-colors"
            >
              <ChevronDown
                size={14}
                className={showMore ? "rotate-180 transition-transform" : "transition-transform"}
                aria-hidden="true"
              />
              Más datos (opcional)
            </button>

            {showMore && (
              <div className="mt-2 space-y-3">
                <div>
                  <label htmlFor="customer-form-email" className="text-xs text-slate-400">Correo</label>
                  <input
                    id="customer-form-email"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="cliente@correo.com"
                    className={inputClass}
                  />
                </div>
                <div className="grid grid-cols-[110px_1fr] gap-2">
                  <div>
                    <label htmlFor="customer-form-doctype" className="text-xs text-slate-400">Documento</label>
                    <select
                      id="customer-form-doctype"
                      value={documentType}
                      onChange={(e) => setDocumentType(e.target.value as DocumentType)}
                      className="mt-1 w-full h-11 rounded-xl bg-slate-800 border border-slate-700 px-2 text-white text-sm outline-none focus:border-vimdy-accent"
                    >
                      <option value="CC">CC</option>
                      <option value="CE">CE</option>
                      <option value="NIT">NIT</option>
                      <option value="PASSPORT">Pasaporte</option>
                      <option value="OTHER">Otro</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="customer-form-docnumber" className="text-xs text-slate-400">Número fiscal</label>
                    <input
                      id="customer-form-docnumber"
                      value={documentNumber}
                      onChange={(e) => setDocumentNumber(e.target.value)}
                      placeholder="Ej. 123456789"
                      inputMode="numeric"
                      autoComplete="off"
                      className={inputClass}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="customer-form-address" className="text-xs text-slate-400">Dirección</label>
                  <input
                    id="customer-form-address"
                    autoComplete="off"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Calle, barrio, ciudad"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="customer-form-notes" className="text-xs text-slate-400">Notas o preferencias</label>
                  <textarea
                    id="customer-form-notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Ej. sin cebolla, alérgico al maní, mesa junto a la ventana"
                    className="mt-1 w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-white text-sm outline-none focus:border-vimdy-accent resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          {duplicate && !localError && (
            <p
              role="status"
              className="rounded-xl border border-vimdy-accent/40 bg-vimdy-accent/10 px-3 py-2 text-slate-200 text-sm"
            >
              Ya existe un cliente con este teléfono: {duplicate.name}.
            </p>
          )}

          {shownError && (
            <p role="alert" className="text-red-400 text-sm">
              {shownError}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 rounded-xl bg-slate-800 border border-slate-700 text-white font-semibold text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 h-11 rounded-xl bg-vimdy-accent hover:bg-vimdy-accent-hover disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold text-sm"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}