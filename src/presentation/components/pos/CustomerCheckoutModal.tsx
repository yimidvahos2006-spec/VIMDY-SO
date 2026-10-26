import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ChevronDown, Loader2, Search, UserPlus, WifiOff } from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { VimdyModal } from "../ui/VimdyModal";
import { Customer } from "../../../core/entities/Entities";
import { connectionStore } from "../../../core/store/connectionStore";
import { toast } from "../../../core/store/toastStore";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { createCustomerFromCheckout } from "../../../core/services/offlineCustomer";
import { useCustomerSearch } from "../../../hooks/useCustomerSearch";
import {
  findCustomerByPhone,
  phoneDigits,
  splitNameAndPhone
} from "../../../core/domain/customers/search";

/**
 * CustomerCheckoutModal
 * ---------------------------------------------------------------------------
 * PASO 4 del plan offline: modal de cliente de Caja pensado para resolver en
 * menos de 5 segundos, con el teclado o con un dedo.
 *
 * FLUJOS (todos empiezan con el cursor ya en el buscador):
 *  - Cliente existente:  escribir 2-3 letras (o los últimos dígitos del
 *    teléfono) -> Enter. Las flechas mueven la selección.
 *  - Cliente nuevo:      escribir "Ana 300 123 4567" -> bajar a "Crear
 *    cliente" -> Enter -> Enter. El nombre y el teléfono se separan solos.
 *  - Teléfono repetido:  el formulario avisa y ofrece usar al cliente que ya
 *    existe, en vez de crear un duplicado.
 *
 * OFFLINE: la búsqueda lee del caché local (useCustomerSearch, Paso 5: nunca
 * espera a la red); crear usa createCustomerFromCheckout()
 * (cola offline + reconexión por teléfono, Pasos 1-3), así que funciona igual
 * sin internet. A diferencia del modal anterior de PosCustomer, que guardaba
 * directo contra el servidor y fallaba sin conexión.
 *
 * El modal NO escribe en usePayment: avisa con onSelect() y el padre decide.
 */

const MAX_RESULTS = 8;
const MIN_NAME_LENGTH = 2;
const MIN_PHONE_DIGITS = 7;

type Mode = "search" | "create";
type DocumentType = NonNullable<Customer["documentType"]>;

interface CustomerCheckoutModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (customer: Customer) => void;
}

const inputClass =
  "mt-1 w-full h-11 rounded-vimdy-md bg-vimdy-surface-active border border-vimdy-border px-3 text-vimdy-text text-vimdy-small outline-none focus:border-vimdy-accent transition-colors placeholder:text-vimdy-text-tertiary";

export function CustomerCheckoutModal({ open, onClose, onSelect }: CustomerCheckoutModalProps) {
  const { t, language } = useTranslation();

  const online = useSyncExternalStore(
    connectionStore.subscribe,
    () => connectionStore.isOnline(),
    () => true
  );

  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [showInvoice, setShowInvoice] = useState(false);
  const [documentType, setDocumentType] = useState<DocumentType>("CC");
  const [documentNumber, setDocumentNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Al abrir: estado limpio. Los clientes se leen del caché local dentro de
  // useCustomerSearch (respuesta inmediata, sin esperar a la red).
  useEffect(() => {
    if (!open) return;

    setMode("search");
    setQuery("");
    setActive(0);
    setName("");
    setPhone("");
    setShowInvoice(false);
    setDocumentType("CC");
    setDocumentNumber("");
    setSaving(false);
    setError(null);
  }, [open]);

  const { customers, results, loading } = useCustomerSearch({
    enabled: open,
    query,
    limit: MAX_RESULTS
  });

  // Las filas son los clientes encontrados + la fila final "Crear cliente".
  const createIndex = results.length;
  const rowCount = results.length + 1;

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active, results]);

  // Cursor en el campo útil al cambiar de vista.
  useEffect(() => {
    if (!open) return;
    if (mode === "search") {
      searchRef.current?.focus();
    } else if (name.trim()) {
      phoneRef.current?.focus();
    } else {
      nameRef.current?.focus();
    }
    // Solo al cambiar de vista; no en cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, open]);

  const duplicate = useMemo(
    () => (mode === "create" ? findCustomerByPhone(customers, phone) : null),
    [mode, customers, phone]
  );

  const draftFromQuery = useMemo(() => splitNameAndPhone(query), [query]);

  function choose(customer: Customer) {
    onSelect(customer);
    onClose();
  }

  function startCreate() {
    setName(draftFromQuery.name);
    setPhone(draftFromQuery.phone);
    setError(null);
    setMode("create");
  }

  function activateRow(index: number) {
    if (index === createIndex) {
      startCreate();
      return;
    }
    const customer = results[index];
    if (customer) choose(customer);
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % rowCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current - 1 + rowCount) % rowCount);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activateRow(Math.min(active, createIndex));
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    // Teléfono ya registrado: se usa ese cliente, no se crea otro.
    if (duplicate) {
      choose(duplicate);
      return;
    }

    const cleanName = name.trim();
    if (cleanName.length < MIN_NAME_LENGTH) {
      setError(t("pos.customerModal.errorName"));
      nameRef.current?.focus();
      return;
    }

    const cleanPhone = phone.trim();
    if (cleanPhone && phoneDigits(cleanPhone).length < MIN_PHONE_DIGITS) {
      setError(t("pos.customerModal.errorPhone"));
      phoneRef.current?.focus();
      return;
    }

    const cleanDocument = documentNumber.trim();

    const customer: Customer = {
      id: crypto.randomUUID(),
      name: cleanName,
      email: "",
      phone: cleanPhone || undefined,
      documentType: cleanDocument ? documentType : undefined,
      documentNumber: cleanDocument || undefined,
      points: 0,
      createdAt: new Date()
    };

    setSaving(true);
    setError(null);

    try {
      const result = await createCustomerFromCheckout(customer);

      if (result.linkedToExisting) {
        toast.info(t("pos.customerModal.linkedToast"));
      }

      choose(result.customer);
    } catch {
      setError(t("pos.customerModal.errorSave"));
      setSaving(false);
    }
  }

  const createLabel = draftFromQuery.name || draftFromQuery.phone
    ? t("pos.customerModal.createNamed", { name: (draftFromQuery.name || draftFromQuery.phone) })
    : t("pos.customerModal.createNew");

  return (
    <VimdyModal
      open={open}
      onClose={onClose}
      size="sm"
      title={mode === "create" ? t("pos.customerModal.newTitle") : t("pos.customerModal.title")}
    >
      {mode === "search" ? (
        <div>
          <div className="flex items-center h-12 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface-active px-3 mb-3 focus-within:border-vimdy-accent transition-colors">
            <Search size={16} className="text-vimdy-text-secondary flex-shrink-0" aria-hidden="true" />
            <input
              ref={searchRef}
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls="customer-checkout-list"
              aria-activedescendant={`customer-checkout-option-${active}`}
              aria-label={t("pos.customerModal.searchAria")}
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("pos.customerModal.searchPlaceholder")}
              className="flex-1 ml-2 bg-transparent outline-none text-vimdy-text text-vimdy-body placeholder:text-vimdy-text-tertiary"
            />
          </div>

          <div
            ref={listRef}
            id="customer-checkout-list"
            role="listbox"
            aria-label={t("pos.customerModal.listAria")}
            className="max-h-72 overflow-y-auto space-y-1.5"
          >
            {loading && customers.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-6 text-vimdy-text-secondary text-vimdy-small">
                <Loader2 size={16} className="animate-vimdy-spin" />
                {t("pos.customerModal.loading")}
              </div>
            ) : (
              <>
                {!query.trim() && results.length > 0 && (
                  <p className="px-1 pb-0.5 text-vimdy-micro text-vimdy-text-tertiary">
                    {t("pos.customerModal.recent")}
                  </p>
                )}

                {results.map((customer, index) => {
                  const isActive = index === active;
                  const points = customer.points ?? 0;
                  return (
                    <div
                      key={customer.id}
                      id={`customer-checkout-option-${index}`}
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(customer)}
                      className={`w-full flex items-center justify-between gap-3 min-h-[48px] rounded-vimdy-md border px-3 py-2 text-left cursor-pointer transition-colors ${
                        isActive
                          ? "border-vimdy-accent bg-vimdy-surface-hover"
                          : "border-vimdy-border bg-vimdy-surface-active"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-vimdy-text font-semibold text-vimdy-small truncate">{customer.name}</p>
                        <p className="text-vimdy-text-secondary text-vimdy-micro truncate">
                          {customer.phone || t("pos.customer.noPhone")}
                        </p>
                      </div>
                      {points > 0 && (
                        <span className="text-vimdy-text-secondary text-vimdy-micro flex-shrink-0">
                          {t("pos.customerModal.points", { points: points.toLocaleString(language) })}
                        </span>
                      )}
                    </div>
                  );
                })}

                {results.length === 0 && (
                  <p className="text-vimdy-text-secondary text-vimdy-small text-center py-3">
                    {query.trim()
                      ? t("pos.customerModal.noResults")
                      : t("pos.customerModal.noCustomersYet")}
                  </p>
                )}

                <div
                  id={`customer-checkout-option-${createIndex}`}
                  role="option"
                  aria-selected={active === createIndex}
                  data-active={active === createIndex}
                  onMouseEnter={() => setActive(createIndex)}
                  onClick={startCreate}
                  className={`flex items-center gap-2.5 min-h-[48px] rounded-vimdy-md border border-dashed px-3 py-2 cursor-pointer text-vimdy-text text-vimdy-small font-semibold transition-colors ${
                    active === createIndex
                      ? "border-vimdy-accent bg-vimdy-surface-hover"
                      : "border-vimdy-border"
                  }`}
                >
                  <UserPlus size={16} className="flex-shrink-0" aria-hidden="true" />
                  <span className="truncate">{createLabel}</span>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-3">
          <VimdyButton
            variant="ghost"
            size="sm"
            icon={<ArrowLeft size={14} />}
            onClick={() => {
              setError(null);
              setMode("search");
            }}
            disabled={saving}
          >
            {t("pos.customerModal.back")}
          </VimdyButton>

          {!online && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface-active px-3 py-2 text-vimdy-text-secondary text-vimdy-micro"
            >
              <WifiOff size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              {t("pos.customerModal.offlineNote")}
            </p>
          )}

          <div>
            <label htmlFor="customer-checkout-name" className="text-vimdy-micro text-vimdy-text-secondary">
              {t("pos.customerModal.nameLabel")}
            </label>
            <input
              id="customer-checkout-name"
              ref={nameRef}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              autoComplete="off"
              placeholder={t("pos.customerModal.namePlaceholder")}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="customer-checkout-phone" className="text-vimdy-micro text-vimdy-text-secondary">
              {t("pos.customerModal.phoneLabel")}
            </label>
            <input
              id="customer-checkout-phone"
              ref={phoneRef}
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setError(null);
              }}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="300 000 0000"
              className={inputClass}
            />
          </div>

          {duplicate && (
            <p
              role="status"
              className="rounded-vimdy-md border border-vimdy-accent/40 bg-vimdy-accent/10 px-3 py-2 text-vimdy-text text-vimdy-small"
            >
              {t("pos.customerModal.duplicateNotice", { name: duplicate.name })}
            </p>
          )}

          {!duplicate && (
            <div>
              <button
                type="button"
                onClick={() => setShowInvoice((current) => !current)}
                aria-expanded={showInvoice}
                className="flex items-center gap-1.5 text-vimdy-text-secondary text-vimdy-small hover:text-vimdy-text transition-colors"
              >
                <ChevronDown
                  size={14}
                  className={showInvoice ? "rotate-180 transition-transform" : "transition-transform"}
                  aria-hidden="true"
                />
                {t("pos.customerModal.invoiceToggle")}
              </button>

              {showInvoice && (
                <div className="mt-2 grid grid-cols-[96px_1fr] gap-2">
                  <div>
                    <label htmlFor="customer-checkout-doctype" className="text-vimdy-micro text-vimdy-text-secondary">
                      {t("pos.customerModal.documentType")}
                    </label>
                    <select
                      id="customer-checkout-doctype"
                      value={documentType}
                      onChange={(event) => setDocumentType(event.target.value as DocumentType)}
                      className={`${inputClass} px-2`}
                    >
                      <option value="CC">CC</option>
                      <option value="CE">CE</option>
                      <option value="NIT">NIT</option>
                      <option value="PASSPORT">Pasaporte</option>
                      <option value="OTHER">Otro</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="customer-checkout-docnumber" className="text-vimdy-micro text-vimdy-text-secondary">
                      {t("pos.customerModal.documentNumber")}
                    </label>
                    <input
                      id="customer-checkout-docnumber"
                      value={documentNumber}
                      onChange={(event) => setDocumentNumber(event.target.value)}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="123456789"
                      className={inputClass}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-vimdy-danger text-vimdy-small">
              {error}
            </p>
          )}

          <VimdyButton type="submit" variant="primary" size="lg" fullWidth loading={saving}>
            {duplicate
              ? t("pos.customerModal.useExisting", { name: duplicate.name })
              : t("pos.customerModal.createAndUse")}
          </VimdyButton>
        </form>
      )}
    </VimdyModal>
  );
}