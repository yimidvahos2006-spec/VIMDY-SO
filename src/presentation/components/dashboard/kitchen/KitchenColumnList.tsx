import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { useTranslation } from "../../../../core/i18n/useTranslation";
import { KitchenOrderView } from "../../../../hooks/useKitchenOrders";
import { computeKitchenDelay } from "../../../../core/services/kitchenDelay";
import { getKitchenNow, subscribeKitchenClock } from "../../../../hooks/useKitchenClock";
import { computeColumnFit } from "./columnFit";

interface Props {
  orders: KitchenOrderView[];
  renderCard: (order: KitchenOrderView) => React.ReactNode;
  /** Qué mostrar cuando la columna no tiene pedidos. */
  empty: React.ReactNode;
  /**
   * true en Modo TV: la lista ocupa el alto que le deja la columna y solo
   * muestra las tarjetas que caben COMPLETAS; el resto se resume en
   * "+N más". false: lista normal que crece hacia abajo.
   */
  fit: boolean;
}

/**
 * Lista de pedidos de una columna del tablero.
 *
 * En Modo TV nadie puede hacer scroll, así que en hora pico los pedidos de
 * abajo desaparecían sin aviso. Ahora cada columna tiene alto propio, y lo
 * que no cabe se oculta limpio (nunca una tarjeta cortada a la mitad) y se
 * cuenta en un contador "+N más". Si entre los ocultos hay pedidos
 * demorados, el contador se pone rojo y lo dice.
 */
export function KitchenColumnList({ orders, renderCard, empty, fit }: Props) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const [hiddenFromState, setHiddenFrom] = useState(orders.length);
  const [firstTooTall, setFirstTooTall] = useState(false);

  const signature = orders.map((order) => order.id).join("|");

  useLayoutEffect(() => {
    if (!fit) {
      setHiddenFrom(orders.length);
      setFirstTooTall(false);
      return;
    }

    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const items = Array.from(list.children) as HTMLElement[];
      const fitResult = computeColumnFit(
        items.map((item) => ({ top: item.offsetTop, height: item.offsetHeight })),
        list.clientHeight
      );
      setHiddenFrom(fitResult.hiddenFrom);
      setFirstTooTall(fitResult.firstTooTall);
    };

    measure();

    // Se vuelve a medir si cambia el tamaño de la columna o de cualquier
    // tarjeta (por ejemplo, al aparecer una nota o al cambiar la pantalla).
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    Array.from(list.children).forEach((child) => observer.observe(child));

    return () => observer.disconnect();
    // `signature` cambia cuando entran, salen o cambian de orden los pedidos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, signature]);

  const hiddenFrom = fit ? Math.min(hiddenFromState, orders.length) : orders.length;
  const hiddenOrders = fit ? orders.slice(hiddenFrom) : [];
  const hiddenCount = hiddenOrders.length;

  // Cuántos de los ocultos ya van demorados. El valor que se compara es un
  // número, así que la lista solo se vuelve a dibujar cuando ese número
  // cambia (no cada segundo).
  const getHiddenDelayed = () =>
    hiddenOrders.reduce(
      (count, order) =>
        computeKitchenDelay(order.createdAt, order.estimatedPrepMinutes, getKitchenNow()).level === "DELAYED"
          ? count + 1
          : count,
      0
    );
  const hiddenDelayed = useSyncExternalStore(subscribeKitchenClock, getHiddenDelayed, getHiddenDelayed);

  if (orders.length === 0) {
    return <>{empty}</>;
  }

  if (!fit) {
    return (
      <div className="space-y-5">
        {orders.map((order) => (
          <div key={order.id}>{renderCard(order)}</div>
        ))}
      </div>
    );
  }

  const showBadge = hiddenCount > 0 || firstTooTall;

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={listRef}
        className={`relative h-full space-y-7 [scrollbar-width:none] ${
          firstTooTall ? "overflow-y-auto" : "overflow-hidden"
        }`}
      >
        {orders.map((order, index) => (
          <div
            key={order.id}
            // invisible = no se ve ni recibe toques, pero conserva su lugar
            // para poder seguir midiéndolo.
            className={index >= hiddenFrom ? "invisible" : undefined}
            aria-hidden={index >= hiddenFrom}
          >
            {renderCard(order)}
          </div>
        ))}
      </div>

      {showBadge && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-vimdy-surface via-vimdy-surface/90 to-transparent pt-12 pb-1">
          <span
            role="status"
            className={`rounded-full border-2 px-8 py-3 text-3xl font-black tabular-nums ${
              hiddenDelayed > 0
                ? "bg-vimdy-danger text-white border-vimdy-danger"
                : "bg-vimdy-surface-hover text-vimdy-text border-vimdy-accent"
            }`}
          >
            {hiddenCount > 0
              ? t("kitchen.dashboard.moreOrders", { count: hiddenCount })
              : t("kitchen.dashboard.tooTall")}
            {hiddenCount > 0 && hiddenDelayed > 0 && (
              <span className="ml-4">{t("kitchen.dashboard.moreDelayed", { count: hiddenDelayed })}</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}