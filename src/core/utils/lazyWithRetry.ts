// src/core/utils/lazyWithRetry.ts
/* ===========================================================================
   CARGA PEREZOSA RESISTENTE A DEPLOYS
   ---------------------------------------------------------------------------
   Problema: Vite nombra cada chunk con un hash (KitchenPage-NXMVi0y3.js).
   Cuando se publica una versión nueva, los chunks viejos desaparecen. Una
   pestaña abierta ANTES del deploy (típico: el POS abierto todo el día)
   sigue pidiendo el chunk viejo al entrar a un módulo y el navegador lanza:
   "Failed to fetch dynamically imported module: KitchenPage-XXXX.js".

   Solución: si el import falla por eso, se reintenta una vez y, si sigue
   fallando, se recarga la página UNA sola vez (con guardia anti-bucle) para
   traer el index.html nuevo con los hashes vigentes. Si aun así falla (red
   caída de verdad), el error sube al ErrorBoundary como siempre.
=========================================================================== */

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const RELOAD_KEY = "vimdy:chunk-reload-at";
/** Ventana en la que NO se vuelve a recargar (evita bucles infinitos). */
const RELOAD_GUARD_MS = 30_000;

const CHUNK_ERROR_PATTERNS = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "unable to preload css",
  "loading chunk",
  "loading css chunk"
];

export function isChunkLoadError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Recarga la página una sola vez por ventana de tiempo.
 * Devuelve true si disparó la recarga, false si la guardia lo impidió.
 */
export function reloadOnceForNewDeploy(now: number = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? "0");
    if (last && now - last < RELOAD_GUARD_MS) return false;
    window.sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    // sessionStorage bloqueado: mejor no recargar que arriesgar un bucle.
    return false;
  }
  window.location.reload();
  return true;
}

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (firstError) {
      if (!isChunkLoadError(firstError)) throw firstError;

      // 1) Un reintento corto (cubre un corte de red momentáneo).
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        return await factory();
      } catch (secondError) {
        if (!isChunkLoadError(secondError)) throw secondError;

        // 2) Chunk inexistente = versión nueva publicada: recargar UNA vez.
        if (reloadOnceForNewDeploy()) {
          // Se queda en "cargando" mientras el navegador recarga.
          return new Promise<{ default: T }>(() => undefined);
        }
        throw secondError;
      }
    }
  });
}