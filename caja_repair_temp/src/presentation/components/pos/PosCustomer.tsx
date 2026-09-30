import React, { useEffect, useState } from "react";
import { User, Plus, X, Search, Crown, Award, Medal, Star, UserPlus, Loader2 } from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { Customer } from "../../../core/entities/Entities";
import { usePayment } from "../../../core/store/usePayment";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { TranslationKey } from "../../../core/i18n/dictionaries";

// Nivel de fidelidad derivado de los puntos reales acumulados en el
// CustomerEngine (Customer.points), que SalesEngine.updateCustomer() va
// sumando en cada venta pagada. Ya no se inventa a partir de un
// "totalSpent" que no existía en el modelo real.
function getLevel(points: number) {
  if (points >= 500) {
    return { nameKey: "pos.customer.levelGold" as TranslationKey, stars: 5, icon: Crown, className: "text-vimdy-gold bg-vimdy-gold/10 border-vimdy-gold/30" };
  }
  if (points >= 150) {
    return { nameKey: "pos.customer.levelSilver" as TranslationKey, stars: 4, icon: Award, className: "text-vimdy-text-secondary bg-vimdy-surface-active border-vimdy-border" };
  }
  return { nameKey: "pos.customer.levelBronze" as TranslationKey, stars: 2, icon: Medal, className: "text-vimdy-bronze bg-vimdy-bronze/10 border-vimdy-bronze/30" };
}

interface PosCustomerProps {
  /**
   * Fase — reubicación del cliente (auditoría "carrito muy cargado"):
   * antes el cliente vivía como tarjeta completa dentro del carrito
   * (PosCart), ocupando espacio vertical que le hacía falta a la lista de
   * productos. Ahora el disparador vive en la barra de pestañas de Caja
   * (CashOperationsPage), en el espacio que antes quedaba vacío junto a
   * "Ventas" — pero es exactamente el mismo componente, mismo store
   * (usePayment) y mismo modal de buscar/crear cliente: solo cambia cómo
   * se ve el botón que lo abre. `compact=true` es un pill chico para esa
   * barra; sin la prop, el comportamiento original (tarjeta completa)
   * queda intacto por si algún otro lugar lo necesita así.
   */
  compact?: boolean;
}

export function PosCustomer({ compact = false }: PosCustomerProps = {}) {
  const { t, language } = useTranslation();
  const { customerId, customerName, setCustomer, clearCustomer } = usePayment();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<Customer | null>(null);

  // Carga real desde CustomerEngine (no un store local desconectado).
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);

    container.customerEngine.get()
      .getAllCustomers()
      .then((list) => {
        if (!cancelled) setCustomers(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Cuando hay un cliente seleccionado, trae su perfil real (puntos) para
  // mostrar el nivel de fidelidad correcto.
  useEffect(() => {
    if (!customerId) {
      setSelectedProfile(null);
      return;
    }

    let cancelled = false;

    container.customerEngine.get()
      .getCustomerProfile(customerId)
      .then((profile) => {
        if (!cancelled) setSelectedProfile(profile.customer);
      })
      .catch(() => {
        if (!cancelled) setSelectedProfile(null);
      });

    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const filtered = customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(search.toLowerCase()) ||
      (customer.phone ?? "").includes(search)
  );

  function handleSelect(customer: Customer) {
    setCustomer(customer.id, customer.name);
    setOpen(false);
    setSearch("");
  }

  async function handleCreate() {
    if (!newName.trim() || saving) return;

    const customer: Customer = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      email: "",
      phone: newPhone.trim() || undefined,
      points: 0,
      createdAt: new Date()
    };

    // BLOQUEANTE (Fase 3 — Caja): antes no había ningún estado "saving" acá.
    // El botón quedaba clickeable y sin ningún indicador mientras
    // container.customerEngine.get().save() esperaba respuesta de red — un
    // cajero con conexión lenta podía tocarlo dos veces y no tenía forma
    // de saber si estaba "pensando" o si el toque no había registrado.
    // Mismo patrón que el botón de Cobrar en PosSalePanel: disabled +
    // Loader2 + texto que cambia mientras dura la operación.
    setSaving(true);

    try {
      await container.customerEngine.get().save(customer);
      setCustomers((prev) => [...prev, customer]);
      handleSelect(customer);
      setCreating(false);
      setNewName("");
      setNewPhone("");
    } finally {
      setSaving(false);
    }
  }

  const level = selectedProfile ? getLevel(selectedProfile.points ?? 0) : null;

  // Disparador compacto (barra de pestañas de Caja): un pill chico en vez
  // de la tarjeta completa. Abre exactamente el mismo modal de abajo — no
  // hay una segunda copia de la lógica de buscar/crear cliente.
  const trigger = compact ? (
    <div className="flex items-center gap-1.5">
      {customerId ? (
        <>
          <button
            onClick={() => setOpen(true)}
            aria-label={t("pos.customer.selectCustomer")}
            title={customerName}
            className="flex items-center gap-2 h-9 max-w-[220px] pl-3 pr-3 rounded-xl border border-vimdy-accent/40 bg-vimdy-accent/10 text-vimdy-text text-sm font-semibold hover:border-vimdy-accent transition-colors"
          >
            <Crown size={14} className="text-vimdy-gold flex-shrink-0" />
            <span className="truncate">{customerName}</span>
          </button>
          <button
            onClick={clearCustomer}
            aria-label={t("pos.customer.clearAria")}
            className="flex items-center justify-center h-9 w-9 rounded-xl border border-vimdy-border bg-vimdy-surface text-vimdy-text-secondary hover:border-vimdy-accent hover:text-vimdy-text transition-colors flex-shrink-0"
          >
            <X size={14} />
          </button>
        </>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 h-9 px-4 rounded-xl border border-vimdy-border bg-vimdy-surface text-vimdy-text text-sm font-semibold hover:border-vimdy-accent transition-colors"
        >
          <Plus size={16} />
          {t("pos.customer.addButton")}
        </button>
      )}
    </div>
  ) : (
    <div className="bg-vimdy-surface border border-vimdy-border rounded-vimdy-lg p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-10 h-10 rounded-full bg-vimdy-accent flex items-center justify-center flex-shrink-0">
            <User size={20} className="text-vimdy-background" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              {customerId ? (
                <Crown size={14} className="text-vimdy-gold flex-shrink-0" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-vimdy-success flex-shrink-0" />
              )}
              <h3 className="text-vimdy-text font-bold leading-snug line-clamp-2">{customerName}</h3>
            </div>

            {customerId && level ? (
              <div className="mt-1 space-y-1">
                <p className="text-vimdy-text-secondary text-vimdy-micro font-semibold">{t("pos.customer.customerOfLevel", { level: t(level.nameKey) })}</p>
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Star
                      key={index}
                      size={13}
                      className={index < level.stars ? "text-vimdy-gold fill-vimdy-gold" : "text-vimdy-border"}
                    />
                  ))}
                </div>
                <p className="text-vimdy-text-tertiary text-vimdy-micro">
                  {t("pos.customer.points", { points: (selectedProfile?.points ?? 0).toLocaleString(language) })}
                </p>
              </div>
            ) : (
              <p className="text-vimdy-text-secondary text-vimdy-small">{t("pos.customer.none")}</p>
            )}
          </div>
        </div>

        {customerId ? (
          <button
            onClick={clearCustomer}
            aria-label={t("pos.customer.clearAria")}
            className="flex items-center justify-center gap-2 h-11 w-11 rounded-vimdy-md bg-vimdy-surface-active border border-vimdy-border hover:border-vimdy-accent transition-all duration-vimdy-normal text-vimdy-text font-semibold flex-shrink-0"
          >
            <X size={16} />
          </button>
        ) : (
          <div className="flex-shrink-0">
            <VimdyButton onClick={() => setOpen(true)} variant="secondary" size="lg" icon={<Plus size={18} />}>
              {t("pos.customer.addButton")}
            </VimdyButton>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {trigger}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            setOpen(false);
            setCreating(false);
          }}
        >
          <div
            className="w-full max-w-sm rounded-vimdy-lg bg-vimdy-surface border border-vimdy-border p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-vimdy-text font-bold">
                {creating ? t("pos.customer.newCustomer") : t("pos.customer.selectCustomer")}
              </h3>
              <button
                onClick={() => {
                  setOpen(false);
                  setCreating(false);
                }}
                aria-label={t("pos.customer.closeAria")}
                className="w-8 h-8 flex items-center justify-center text-vimdy-text-secondary hover:text-vimdy-text transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {creating ? (
              <div className="space-y-3">
                <div>
                  <label className="text-vimdy-micro text-vimdy-text-secondary">{t("pos.customer.name")}</label>
                  <input
                    autoFocus
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder={t("pos.customer.namePlaceholder")}
                    className="mt-1 w-full h-11 rounded-vimdy-md bg-vimdy-surface-active border border-vimdy-border px-3 text-vimdy-text text-vimdy-small outline-none focus:border-vimdy-accent transition-colors"
                  />
                </div>
                <div>
                  <label className="text-vimdy-micro text-vimdy-text-secondary">{t("pos.customer.phoneOptional")}</label>
                  <input
                    value={newPhone}
                    onChange={(event) => setNewPhone(event.target.value)}
                    placeholder="300 000 0000"
                    className="mt-1 w-full h-11 rounded-vimdy-md bg-vimdy-surface-active border border-vimdy-border px-3 text-vimdy-text text-vimdy-small outline-none focus:border-vimdy-accent transition-colors"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <div className="flex-1">
                    <VimdyButton onClick={() => setCreating(false)} disabled={saving} variant="secondary" fullWidth>
                      {t("common.cancel")}
                    </VimdyButton>
                  </div>
                  <div className="flex-1">
                    <VimdyButton
                      onClick={handleCreate}
                      disabled={!newName.trim()}
                      loading={saving}
                      variant="primary"
                      fullWidth
                    >
                      {t("pos.customer.saveAndUse")}
                    </VimdyButton>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center h-11 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface-active px-3 mb-3 focus-within:border-vimdy-accent transition-colors">
                  <Search size={16} className="text-vimdy-text-secondary flex-shrink-0" />
                  <input
                    autoFocus
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("pos.customer.searchPlaceholder")}
                    className="flex-1 ml-2 bg-transparent outline-none text-vimdy-text text-vimdy-small placeholder:text-vimdy-text-tertiary"
                  />
                </div>

                <div className="mb-2">
                  <VimdyButton
                    onClick={() => {
                      setNewName(search);
                      setCreating(true);
                    }}
                    variant="secondary"
                    icon={<UserPlus size={16} />}
                    fullWidth
                  >
                    {t("pos.customer.registerNew")}
                  </VimdyButton>
                </div>

                <div className="max-h-56 overflow-y-auto space-y-2">
                  {loading ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-vimdy-text-secondary text-vimdy-small">
                      <Loader2 size={16} className="animate-vimdy-spin" />
                      {t("pos.customer.loadingCustomers")}
                    </div>
                  ) : filtered.length === 0 ? (
                    <p className="text-vimdy-text-secondary text-vimdy-small text-center py-6">{t("pos.customer.noCustomers")}</p>
                  ) : (
                    filtered.map((customer) => {
                      const customerLevel = getLevel(customer.points ?? 0);
                      const Icon = customerLevel.icon;
                      return (
                        <button
                          key={customer.id}
                          onClick={() => handleSelect(customer)}
                          className="w-full flex items-center justify-between gap-3 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface-active hover:border-vimdy-accent px-3 py-2.5 text-left transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-vimdy-text font-semibold text-vimdy-small truncate">{customer.name}</p>
                            <p className="text-vimdy-text-secondary text-vimdy-micro">{customer.phone || t("pos.customer.noPhone")}</p>
                          </div>
                          <span
                            className={`flex items-center gap-1 text-vimdy-micro font-semibold px-2 py-0.5 rounded-vimdy-xs border flex-shrink-0 ${customerLevel.className}`}
                          >
                            <Icon size={11} />
                            {t(customerLevel.nameKey)}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}