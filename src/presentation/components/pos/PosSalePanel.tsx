import React, { useEffect, useState } from "react";
import { ShoppingCart, CreditCard, Receipt, Lock, ChefHat } from "lucide-react";

import { useCart } from "../../../core/store/useCart";
import { usePayment } from "../../../core/store/usePayment";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { processSale } from "../../../core/services/processSale";
import { useAuth } from "../../context/AuthContext";
import { toast } from "../../../core/store/toastStore";
import { PosCart } from "./PosCart";
import { PosCheckoutPanel } from "./PosCheckoutPanel";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { formatMoney } from "../../../core/utils/formatMoney";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import { VimdyButton } from "../ui/VimdyButton";

/**
 * Panel único de "Venta actual": Carrito y Pago (antes dos columnas, luego
 * dos pestañas) ahora van uno debajo del otro en un solo flujo continuo:
 * Productos -> Cliente -> Descuento -> Prioridad -> Método -> Recibido ->
 * Cambio -> Total -> COBRAR. Así el ojo no tiene que saltar de un lado a
 * otro ni cambiar de pestaña, y el orden sigue exactamente el orden real
 * en que se cobra una venta. El total y el botón COBRAR quedan fijos
 * abajo, siempre visibles.
 *
 * Caja SIEMPRE cobra en un solo clic, sin importar el tipo de negocio
 * (con o sin módulo Cocina, venta rápida de mostrador o comida que se
 * prepara en cocina). Antes había un botón "Enviar cocina" separado que
 * había que tocar primero (y solo después aparecía "Cobrar") cuando el
 * módulo Cocina estaba activo — eso hacía parecer que Caja "no cobraba,
 * solo mandaba a cocina". No hacía falta: SalesEngine.createSale() ya
 * manda la comanda a Cocina de forma automática dentro del mismo
 * processSale(), filtrando solo los productos marcados con
 * requiresKitchen (ver SalesEngine.sendToKitchen) — así que un solo botón
 * "Cobrar" ya cobra Y manda lo que corresponda a Cocina en la misma
 * acción, para cualquier tipo de negocio.
 *
 * Mesas/Meseros es distinto a propósito y NO cambia: ahí sí tiene sentido
 * mandar el pedido a cocina mientras la gente come, y cobrar solo al
 * final cuando piden la cuenta (ver CloseTableDialog.tsx/TableEngine).
 */
export function PosSalePanel() {

  const { t, language } = useTranslation();

  const { items } = useCart();
  const { total, method, received, mixedReceived, requiresInvoice } = usePayment();
  const { user } = useAuth();

  const [processing, setProcessing] = useState(false);

  // IDEMPOTENCIA (checklist crítico #4): id del intento de cobro actual,
  // generado UNA sola vez (con el primer click de "Cobrar") y reutilizado
  // en cada reintento mientras dure ese mismo intento — si el primer click
  // falla a mitad de camino (datáfono caído, red que se corta) y el
  // cajero le vuelve a dar al botón, se manda el MISMO id, así que
  // SalesEngine.createSale() reconoce que ya existe esa venta en vez de
  // crear una segunda con doble descuento de inventario y doble comanda.
  // Si el carrito cambia sin que el intento anterior haya terminado, ese
  // id ya no corresponde a lo que se va a cobrar y se descarta.
  const [saleAttemptId, setSaleAttemptId] = useState<string | null>(null);

  useEffect(() => {
    setSaleAttemptId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Si no hay un turno de caja abierto, no se puede cobrar. Se consulta
  // por polling (igual que ShiftPanel) porque el turno se abre/cierra
  // desde la otra pestaña (Turno de caja) y no emite eventos.
  const [shiftOpen, setShiftOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function checkShift() {
      const current = await container.shiftEngine.getCurrentShift();
      if (!cancelled) setShiftOpen(current !== null);
    }

    checkShift();
    const interval = setInterval(checkShift, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const canCharge =
    shiftOpen &&
    items.length > 0 &&
    (method !== "cash" || received >= total) &&
    (method !== "mixed" || mixedReceived >= total);

  async function handleCharge() {

    if (!shiftOpen) {
      toast.error(t("pos.sale.shiftClosedToast"));
      return;
    }

    if (items.length === 0) {
      toast.warning(t("pos.sale.addProductsBeforeChargeToast"));
      return;
    }

    if (!user) {
      toast.error(t("pos.sale.noCashierToast"));
      return;
    }

    const attemptId = saleAttemptId ?? crypto.randomUUID();
    if (!saleAttemptId) setSaleAttemptId(attemptId);

    setProcessing(true);
    try {
      const success = await processSale({
        cashierId: user.id,
        cashierName: user.name,
        saleId: attemptId
      });

      if (success) {
        toast.success(t("pos.sale.saleSuccessToast"));
        // Venta cobrada de verdad: el intento terminó, se libera el id
        // para que la siguiente venta arranque desde cero.
        setSaleAttemptId(null);
      }
    } finally {
      setProcessing(false);
    }

  }

  // Paso 2.6 (Cocina en el botón de Caja): el botón sigue cobrando SIEMPRE
  // en un solo clic (handleCharge no cambia), pero ahora avisa con su
  // propio texto/ícono qué va a pasar con la comanda, según el switch
  // "Cocina" de cada producto (Inventario -> Product.requiresKitchen):
  //   - si el carrito tiene AL MENOS un producto de cocina -> "Cocina"
  //   - si NINGÚN producto del carrito es de cocina -> "Cobrar"
  // Factura sigue mandando sobre esto (un cobro con factura siempre avisa
  // que factura, aunque también mande a cocina por dentro).
  const hasKitchenItems = items.some((item) => item.requiresKitchen !== false);
  const chargeLabel = requiresInvoice
    ? t("pos.sale.chargeAndInvoice")
    : hasKitchenItems
    ? t("pos.sale.sendToKitchen")
    : t("pos.sale.charge");
  const ChargeIcon = requiresInvoice ? Receipt : hasKitchenItems ? ChefHat : CreditCard;

  return (

    <div className="h-full flex flex-col">

      {/* Encabezado */}
      <div className="border-b border-vimdy-border px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ShoppingCart size={22} className="text-vimdy-accent-hover" />
          <div>
            <h2 className="text-vimdy-h3 text-vimdy-text">{t("pos.sale.title")}</h2>
            <p className="text-vimdy-micro text-vimdy-text-secondary">{t("pos.sale.itemCount", { count: items.length })}</p>
          </div>
        </div>
      </div>

      {/* Un solo flujo: Productos -> Cliente -> Descuento -> Prioridad -> Método */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-vimdy-border">
        <PosCart />
        <PosCheckoutPanel />
      </div>

      {/* Total + botón inteligente: fijo abajo, siempre visible sin necesidad de scrollear */}
      <div className="border-t border-vimdy-border bg-vimdy-surface p-4 flex-shrink-0 space-y-3">

        {!shiftOpen && (
          <div className="flex items-center gap-2 bg-vimdy-warning-bg border border-vimdy-warning/30 text-vimdy-warning rounded-vimdy-md px-4 py-2.5 text-vimdy-small">
            <Lock className="w-4 h-4 shrink-0" />
            {t("pos.sale.shiftClosedBanner")}
          </div>
        )}

        <div className="rounded-vimdy-md bg-vimdy-background border border-vimdy-border px-4 py-4 text-center [container-type:inline-size]">
          <span className="block text-vimdy-text-secondary text-vimdy-micro uppercase tracking-[0.25em] font-bold">
            {t("pos.sale.totalWithTax")}
          </span>
          <span className="block text-vimdy-accent-hover font-black leading-tight tabular-nums mt-1 text-[clamp(1.75rem,10cqw,3.75rem)]">
            {formatMoney(total, companyConfigStore.get().currency, language)}
          </span>
        </div>

        {/*
          Fase 3 — botón COBRAR migrado a VimdyButton (09_BUTTON_SYSTEM.md):
          es la única acción principal de la pantalla de Caja, así que va
          variant="primary" — y por la regla suprema del sistema ("solo un
          primary por pantalla"), en esta vista no debe convivir con ningún
          otro botón primary. El gradiente, el glow (animate-cobrar-glow) y
          el hover:scale que tenía antes salieron porque el spec de botones
          los prohíbe explícitamente para cualquier variante ("nunca tendrá
          gradientes", "nunca tendrá sombra", animaciones solo funcionales).
          El estado `processing` ya no dibuja su propio spinner+texto a
          mano: se lo pasamos al prop `loading` de VimdyButton, que ya
          resuelve exactamente el bloqueante que el comentario anterior
          describía (texto se oculta con `invisible`, el botón no cambia de
          ancho, spinner centrado) — mismo comportamiento, sin duplicar la
          lógica en cada pantalla.
          NOTA para Yimid: el tamaño quedó en size="lg" (48px, el máximo que
          define el spec) en vez de los h-20 (80px) que tenía antes. Si
          preferís mantener el botón más grande/prominente por ser la
          acción de mayor tráfico de toda la app, avisá y lo ajustamos con
          una excepción documentada — no lo agrandé por mi cuenta para no
          revertir en silencio una decisión de diseño que no sé si fue
          intencional.
        */}
        <VimdyButton
          onClick={handleCharge}
          disabled={!canCharge}
          loading={processing}
          variant="primary"
          size="lg"
          fullWidth
          icon={<ChargeIcon size={22} />}
          className="tracking-wide"
        >
          {chargeLabel.toUpperCase()}
        </VimdyButton>

      </div>

    </div>

  );

}