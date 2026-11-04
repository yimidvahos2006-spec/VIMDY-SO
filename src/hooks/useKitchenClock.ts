import { useSyncExternalStore } from "react";

import {
  computeKitchenDelay,
  KitchenDelayInfo,
  KitchenDelayLevel
} from "../core/services/kitchenDelay";

/* ===========================================================================
   useKitchenClock
   ---------------------------------------------------------------------------
   UN solo reloj compartido por todas las tarjetas de Cocina.

   Antes cada cronómetro tenía su propio setInterval y arrancaba en "0m 0s"
   durante un segundo cada vez que la tarjeta se montaba (por ejemplo al
   pasar de columna). Ahora:
     - hay un solo temporizador para toda la pantalla;
     - el tick cae justo al cambiar cada segundo, así todos los cronómetros
       avanzan a la vez y sin saltos;
     - el valor se calcula desde el primer render (nunca se ve "0m 0s");
     - al volver a la pestaña (después de que el navegador la durmió) se
       actualiza al instante.
=========================================================================== */

const listeners = new Set<() => void>();
let current = floorToSecond(Date.now());
let timer: ReturnType<typeof setTimeout> | null = null;

function floorToSecond(ms: number): number {
  return Math.floor(ms / 1000) * 1000;
}

function schedule() {
  if (timer) clearTimeout(timer);
  // Cae unos milisegundos después del cambio de segundo.
  timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
}

function tick() {
  current = floorToSecond(Date.now());
  listeners.forEach((listener) => listener());
  schedule();
}

function handleVisibility() {
  if (typeof document !== "undefined" && !document.hidden) tick();
}

export function subscribeKitchenClock(listener: () => void): () => void {
  listeners.add(listener);

  if (listeners.size === 1) {
    current = floorToSecond(Date.now());
    schedule();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }
  }

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) {
      if (timer) clearTimeout(timer);
      timer = null;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    }
  };
}

/** Hora actual (en ms, redondeada al segundo) según el reloj compartido. */
export function getKitchenNow(): number {
  return listeners.size > 0 ? current : floorToSecond(Date.now());
}

/** Re-renderiza cada segundo. Solo para el cronómetro visible. */
export function useKitchenNow(): number {
  return useSyncExternalStore(subscribeKitchenClock, getKitchenNow, getKitchenNow);
}

/** Demora completa del pedido; se actualiza cada segundo (para el cronómetro). */
export function useKitchenDelay(
  createdAt: Date | string | number,
  estimatedMinutes: number | null | undefined
): KitchenDelayInfo {
  const now = useKitchenNow();
  return computeKitchenDelay(createdAt, estimatedMinutes, now);
}

/**
 * Solo el nivel (en tiempo / por vencer / demorado). Como el valor que se
 * compara es un texto, la tarjeta únicamente se vuelve a dibujar cuando el
 * nivel cambia (2 veces en la vida del pedido), no cada segundo.
 */
export function useKitchenDelayLevel(
  createdAt: Date | string | number,
  estimatedMinutes: number | null | undefined
): KitchenDelayLevel {
  const getSnapshot = () =>
    computeKitchenDelay(createdAt, estimatedMinutes, getKitchenNow()).level;

  return useSyncExternalStore(subscribeKitchenClock, getSnapshot, getSnapshot);
}