import React, { useState } from "react";
import { X, Rocket } from "lucide-react";

import { PlansShowcase } from "./PlansShowcase";
import { PlanDefinition, getPlanPrice, getPlanCurrency } from "../../../core/entities/SubscriptionTypes";
import { useAuth } from "../../context/AuthContext";
import { toast } from "../../../core/store/toastStore";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import {
  VimdyPayments,
  PaymentCountryResolver,
  PaymentCurrencyResolver,
  type PaymentProviderName,
  type CurrencyCode as PaymentsCurrencyCode
} from "../../../core/payments";

interface Props {
  onClose: () => void;
}

/**
 * Nombre comercial de cada proveedor. Es lo único de payments/ que el
 * resto de VIMDY necesita saber: cómo se llama la pasarela ante el
 * usuario — nunca cómo decide el Router ni cómo funciona por dentro.
 */
const PROVIDER_LABELS: Record<PaymentProviderName, string> = {
  wompi: "Wompi",
  mercadopago: "Mercado Pago",
  paypal: "PayPal"
};

/**
 * UpgradeModal
 * ---------------------------------------------------------------------------
 * VIMDY — FASE 7, PASO 6/7 + FASE 8.2 (VIMDY Payments — el cerebro decide) +
 * MISIÓN 3 (Wompi real).
 * Es lo que abre cualquier botón "Ver planes" / "Actualizar ahora" /
 * "Actualizar plan" de toda la app (aviso de PASO 4, pantalla de
 * vencimiento de PASO 5, Configuración > Suscripción de PASO 8).
 *
 * `handleSelectPlan` toma el país real del negocio (companyConfigStore,
 * hidratado desde Supabase al iniciar sesión — ver AuthContext.hydrateBusinessConfig)
 * y se lo entrega a VimdyPayments junto con el businessId de la sesión activa.
 * Es GlobalPaymentRouter — y solo él, a través de PaymentCountryResolver —
 * quien decide si ese negocio paga con Wompi, Mercado Pago o PayPal. Aquí
 * no vive ningún if/else de país.
 *
  * MISIÓN 3: cuando el proveedor resuelto es Wompi, `VimdyPayments.pay`
  * devuelve un `checkoutUrl` real (armado por la Edge Function
  * wompi-create-checkout, firmado con la llave de integridad) y este
  * componente redirige el navegador ahí mismo — el pago real ocurre en la
  * página hospedada por Wompi, nunca dentro de VIMDY. Mercado Pago y PayPal
  * también redirigen a sus respectivos checkouts cuando las credenciales
  * externas están configuradas; mientras tanto, si falta alguna configuración,
  * se muestra el aviso de "en proceso de aprobación".
 */
export function UpgradeModal({ onClose }: Props) {
  const { businessId } = useAuth();
  const [notice, setNotice] = useState<string | null>(null);

  const { country } = companyConfigStore.get();
  const providerForCountry = PaymentCountryResolver.resolve(country);
  const providerLabel = PROVIDER_LABELS[providerForCountry];
  const currencyForCountry = PaymentCurrencyResolver.resolve(country);

  async function handleSelectPlan(plan: PlanDefinition) {
    if (!businessId) return;

    try {
      const displayPrice = getPlanPrice(plan.id, country);
      const displayCurrency = getPlanCurrency(plan.id, country);

      const result = await VimdyPayments.pay({
        businessId,
        country,
        businessType: "suscripcion_vimdy",
        plan: plan.id,
        amount: displayPrice,
        currency: displayCurrency
      });

      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }

      const resolvedLabel = PROVIDER_LABELS[result.provider];

      setNotice(
        `Estamos terminando de activar los pagos en línea con ${resolvedLabel}. Muy pronto podrás activar el ${plan.name} aquí mismo, sin salir de VIMDY.`
      );
      toast.info(
        `${resolvedLabel} está en proceso de aprobación para tu país. Te avisaremos apenas esté disponible.`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No pudimos iniciar el proceso de pago. Intenta de nuevo en unos minutos."
      );
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl bg-vimdy-background border border-vimdy-border p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <Rocket size={20} className="text-vimdy-accent" />
            <h2 className="text-vimdy-text font-bold text-xl">Elige tu plan</h2>
          </div>
          <button onClick={onClose} className="text-vimdy-text-secondary hover:text-vimdy-text">
            <X size={20} />
          </button>
        </div>
        <p className="text-vimdy-text-secondary text-sm mb-5">
          Gracias por confiar en VIMDY. Elige el plan que mejor se ajuste a tu negocio y sigue
          administrándolo sin interrupciones.
        </p>

        {notice && (
          <div className="mb-4 rounded-xl border border-vimdy-accent/30 bg-vimdy-accent/10 text-vimdy-accent-hover text-sm px-4 py-3">
            {notice}
          </div>
        )}

        <PlansShowcase onSelectPlan={handleSelectPlan} countryCode={country} />

        <p className="text-vimdy-text-tertiary text-xs mt-5 text-center">
          Pagos procesados de forma segura por {providerLabel}. Puedes cambiar de plan cuando quieras.
        </p>
      </div>
    </div>
  );
}