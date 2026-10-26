import React, { useEffect, useState } from "react";
import { User, Plus, X, Crown, Award, Medal, Star } from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { CustomerCheckoutModal } from "./CustomerCheckoutModal";
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

  // El buscador/creador de clientes vive en CustomerCheckoutModal (Paso 4).
  const [open, setOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<Customer | null>(null);

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

  function handleSelect(customer: Customer) {
    setCustomer(customer.id, customer.name);
    setOpen(false);
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

      <CustomerCheckoutModal
        open={open}
        onClose={() => setOpen(false)}
        onSelect={handleSelect}
      />
    </>
  );
}