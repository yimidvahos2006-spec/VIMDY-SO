import React, { useEffect, useState } from "react";
import { CreditCard, CalendarClock, Receipt, ArrowUpCircle, Loader2 } from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { useSubscription } from "../../../core/store/useSubscription";
import { subscriptionStore } from "../../../core/store/subscriptionStore";
import { VimdyButton } from "../ui/VimdyButton";
import { fetchSubscription, fetchSubscriptionPayments } from "../../../infrastructure/supabase/subscriptionContext";
import { formatMoney } from "../../../core/utils/formatMoney";
import { toast } from "../../../core/store/toastStore";
import { SubscriptionCountdownBadge } from "./SubscriptionCountdownBadge";
import { UpgradeModal } from "./UpgradeModal";

const PLAN_LABEL: Record<string, string> = {
  trial: "🟢 Prueba Gratuita",
  monthly: "🔵 Plan Mensual",
  yearly: "🟣 Plan Anual",
  suspended: "🔴 Suspendido"
};

/** Cada cuánto se vuelve a consultar mientras se confirma un pago recién hecho en Wompi. */
const CONFIRMATION_POLL_INTERVAL_MS = 3000;
/** Tope de intentos (30s en total) — de ahí en adelante el webhook de Wompi puede tardar más de lo normal, así que se deja de bloquear la pantalla. */
const CONFIRMATION_MAX_ATTEMPTS = 10;

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  wompi_card: "Wompi · Tarjeta",
  wompi_pse: "Wompi · PSE",
  wompi_nequi: "Wompi · Nequi",
  mercadopago_wallet: "Mercado Pago · Billetera",
  mercadopago_card: "Mercado Pago · Tarjeta",
  mercadopago_bank_transfer: "Mercado Pago · Transferencia",
  paypal: "PayPal"
};

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * SubscriptionSettingsSection
 * ---------------------------------------------------------------------------
 * VIMDY — FASE 7, PASO 8: sección "Suscripción" en Configuración. Muestra
 * plan actual, días restantes, fecha de vencimiento, historial de pagos y
 * el botón "Actualizar plan". Pensada para insertarse como una tarjeta más
 * dentro de la grilla de SettingsDashboard.tsx (mismo patrón de SectionCard).
 *
 * MISIÓN 3 — Wompi real: cuando el usuario vuelve del Web Checkout de
 * Wompi, wompi-create-checkout lo trae de regreso acá con
 * `?wompi_ref=<referencia>` en la URL (ver redirectUrl en esa Edge
 * Function). Ese parámetro NUNCA activa nada por sí solo — la activación
 * real ya la hizo (o no) wompi-webhook en el servidor antes de que el
 * usuario llegara a esta pantalla. Acá solo se hace polling corto contra
 * Supabase para reflejar ese resultado real en la UI sin que el usuario
 * tenga que recargar la página a mano.
 */
export function SubscriptionSettingsSection() {
  const { businessId } = useAuth();
  const { plan, daysRemaining, trialEndsAt, renewalDate, nextChargeAt, paymentMethod, payments, isTrial } =
    useSubscription();
  const [upgrading, setUpgrading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    setLoadingHistory(true);
    fetchSubscriptionPayments(businessId)
      .then((history) => subscriptionStore.setPayments(history))
      .finally(() => setLoadingHistory(false));
  }, [businessId]);

  // Confirmar el regreso real del proveedor de pago (Wompi, MercadoPago o
  // PayPal) — el parámetro de la URL NUNCA activa nada por sí solo, la
  // activación real ya la hizo (o no) el webhook correspondiente en el
  // servidor antes de que el usuario llegara a esta pantalla. Acá solo se
  // hace polling corto para reflejar ese resultado real en la UI.
  useEffect(() => {
    if (!businessId) return;

    const params = new URLSearchParams(window.location.search);
    const wompiReference = params.get("wompi_ref");
    const mercadopagoReference = params.get("external_reference");
    const paypalOrderId = params.get("token");
    const pago = params.get("pago"); // "exitoso" | "fallido" | "cancelado" | "pendiente" (back_urls de MercadoPago/PayPal)

    const reference = wompiReference ?? mercadopagoReference ?? paypalOrderId;

    if (!reference && !pago) return;

    // Se limpia la URL de inmediato: si el usuario recarga la página no
    // debe volver a disparar el polling de una referencia ya resuelta.
    ["wompi_ref", "external_reference", "token", "PayerID", "collection_id", "collection_status", "payment_id", "status", "preference_id", "merchant_order_id", "pago"].forEach(
      (key) => params.delete(key)
    );
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);

    // El usuario canceló el pago antes de terminar: no hay nada que
    // confirmar contra el servidor, se avisa directo.
    if (pago === "cancelado" && !reference) {
      toast.info("Cancelaste el pago. Puedes intentarlo de nuevo cuando quieras.");
      return;
    }

    if (!reference) return;

    let cancelled = false;
    setConfirmingPayment(true);

    async function pollOnce(attempt: number) {
      const [subscription, history] = await Promise.all([
        fetchSubscription(businessId as string),
        fetchSubscriptionPayments(businessId as string)
      ]);

      if (cancelled) return;

      subscriptionStore.setPayments(history);
      if (subscription) {
        subscriptionStore.updateSubscription(subscription);
      }

      const matchingPayment = history.find(
        (payment) =>
          payment.wompiReference === reference ||
          payment.mercadopagoReference === reference ||
          payment.paypalOrderId === reference
      );

      if (matchingPayment && matchingPayment.status !== "pending") {
        setConfirmingPayment(false);
        if (matchingPayment.status === "approved") {
          toast.success("¡Tu pago fue aprobado! Tu plan ya está activo.");
        } else if (matchingPayment.status === "error") {
          toast.error(
            "Tu pago se cobró, pero hubo un problema al activar el plan. Ya lo estamos revisando — escríbenos por soporte para agilizarlo."
          );
        } else {
          toast.error("El pago fue rechazado. Puedes intentar de nuevo cuando quieras.");
        }
        return;
      }

      if (attempt >= CONFIRMATION_MAX_ATTEMPTS) {
        setConfirmingPayment(false);
        toast.info("Seguimos confirmando tu pago. Si tarda más de unos minutos, actualiza esta página.");
        return;
      }

      setTimeout(() => pollOnce(attempt + 1), CONFIRMATION_POLL_INTERVAL_MS);
    }

    pollOnce(1);

    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const expirationLabel = isTrial ? "Vence" : "Próxima renovación";
  const expirationDate = isTrial ? trialEndsAt : renewalDate ?? nextChargeAt;

  return (
    <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface p-5">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-vimdy-background flex items-center justify-center flex-shrink-0">
          <CreditCard size={18} className="text-vimdy-accent" />
        </div>
        <div>
          <h3 className="text-vimdy-text font-bold">Suscripción</h3>
          <p className="text-vimdy-text-secondary text-xs">Plan actual, vencimiento e historial de pagos.</p>
        </div>
      </div>

      {confirmingPayment && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-vimdy-accent/30 bg-vimdy-accent/10 text-vimdy-accent-hover text-sm px-4 py-3">
          <Loader2 size={16} className="animate-spin flex-shrink-0" />
          Estamos confirmando tu pago. Esto puede tardar unos segundos...
        </div>
      )}

      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between rounded-xl border border-vimdy-border bg-vimdy-background/60 px-4 py-3">
          <div>
            <p className="text-vimdy-text-secondary text-xs">Plan actual</p>
            <p className="text-vimdy-text font-semibold text-sm mt-0.5">{plan ? PLAN_LABEL[plan] : "—"}</p>
          </div>
          <SubscriptionCountdownBadge compact />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-vimdy-border bg-vimdy-background/60 px-4 py-3">
            <p className="text-vimdy-text-secondary text-xs flex items-center gap-1.5">
              <CalendarClock size={13} /> {expirationLabel}
            </p>
            <p className="text-vimdy-text font-semibold text-sm mt-0.5">{formatDate(expirationDate)}</p>
          </div>
          <div className="rounded-xl border border-vimdy-border bg-vimdy-background/60 px-4 py-3">
            <p className="text-vimdy-text-secondary text-xs">Días restantes</p>
            <p className="text-vimdy-text font-semibold text-sm mt-0.5">
              {isTrial ? `${Math.max(daysRemaining, 0)} días` : "Plan activo"}
            </p>
          </div>
        </div>

        {paymentMethod && (
          <div className="rounded-xl border border-vimdy-border bg-vimdy-background/60 px-4 py-3">
            <p className="text-vimdy-text-secondary text-xs">Método de pago</p>
            <p className="text-vimdy-text font-semibold text-sm mt-0.5">
              {PAYMENT_METHOD_LABEL[paymentMethod] ?? paymentMethod}
            </p>
          </div>
        )}

        <div>
          <p className="text-vimdy-text-secondary text-xs flex items-center gap-1.5 mb-2">
            <Receipt size={13} /> Historial de pagos
          </p>

          {loadingHistory ? (
            <p className="text-vimdy-text-tertiary text-xs px-1">Cargando historial...</p>
          ) : payments.length === 0 ? (
            <p className="text-vimdy-text-tertiary text-xs px-1">
              Todavía no hay pagos registrados. Cuando actives un plan, cada cobro aparecerá aquí.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border border-vimdy-border bg-vimdy-background/60 px-3 py-2 text-xs"
                >
                  <div>
                    <p className="text-vimdy-text font-medium">{PLAN_LABEL[p.plan] ?? p.plan}</p>
                    <p className="text-vimdy-text-tertiary">{formatDate(p.paidAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-vimdy-text font-semibold">{formatMoney(p.amount, p.currency)}</p>
                    <p
                      className={`${
                        p.status === "approved"
                          ? "text-vimdy-success"
                          : p.status === "declined"
                          ? "text-vimdy-danger"
                          : p.status === "error"
                          ? "text-vimdy-danger"
                          : "text-vimdy-warning"
                      }`}
                    >
                      {p.status === "approved"
                        ? "Aprobado"
                        : p.status === "declined"
                        ? "Rechazado"
                        : p.status === "error"
                        ? "En revisión"
                        : "Pendiente"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <VimdyButton
          onClick={() => setUpgrading(true)}
          variant="primary"
          icon={<ArrowUpCircle size={16} />}
          fullWidth
        >
          Actualizar plan
        </VimdyButton>
      </div>

      {upgrading && <UpgradeModal onClose={() => setUpgrading(false)} />}
    </div>
  );
}