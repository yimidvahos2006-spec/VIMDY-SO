// src/presentation/components/pos/posShortcuts.ts
/* ===========================================================================
   ATAJOS DE TECLADO DEL POS (modo rápido para hora pico)
   ---------------------------------------------------------------------------
     F2     -> ir al buscador de productos (y seleccionar su texto)
     Enter  -> cobrar (solo si la venta se puede cobrar)
     Esc    -> 1ª vez limpia la búsqueda; si ya está vacía, limpia la venta

   La decisión vive aquí como función PURA para poder probarla sin DOM.
   Los componentes solo arman el contexto (classifyShortcutTarget) y ejecutan
   la acción que esta función devuelve.
=========================================================================== */

export type ShortcutTargetKind =
  /** Nada enfocado (body): el cajero está "en el aire". */
  | "none"
  /** Campo/botón marcado con data-pos-enter-charge (efectivo recibido,
   *  referencia, montos rápidos): ahí Enter significa COBRAR. */
  | "charge-ok"
  /** Cualquier otro input/textarea/select/contenteditable. */
  | "editable"
  /** Cualquier otro botón o enlace (Enter lo activa de forma nativa). */
  | "control";

export interface PosShortcutContext {
  readonly key: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly targetKind: ShortcutTargetKind;
  /** Hay un modal/diálogo abierto: los atajos del POS se apagan. */
  readonly modalOpen: boolean;
  /** Se está procesando un cobro. */
  readonly processing: boolean;
  /** La venta cumple todo para cobrarse (turno abierto, recibido >= total...). */
  readonly canCharge: boolean;
  readonly searchHasText: boolean;
  readonly cartHasItems: boolean;
}

export type PosShortcutAction =
  | "focus-search"
  | "charge"
  | "clear-search"
  | "clear-sale"
  | "none";

export function resolvePosShortcut(ctx: PosShortcutContext): PosShortcutAction {
  // Combinaciones con Ctrl/Cmd/Alt son del navegador o de otros atajos (Ctrl+K).
  if (ctx.ctrlKey || ctx.metaKey || ctx.altKey) return "none";
  if (ctx.modalOpen) return "none";

  if (ctx.key === "F2") return "focus-search";

  if (ctx.key === "Enter") {
    // Mantener Enter apretado NUNCA debe cobrar dos veces.
    if (ctx.repeat || ctx.processing) return "none";
    if (ctx.targetKind !== "none" && ctx.targetKind !== "charge-ok") return "none";
    return ctx.canCharge ? "charge" : "none";
  }

  if (ctx.key === "Escape") {
    if (ctx.processing) return "none";
    if (ctx.searchHasText) return "clear-search";
    // Si el foco está en otro campo con texto, Esc solo lo suelta: no se
    // borra la venta por accidente mientras se escribe algo.
    if (ctx.targetKind === "editable") return "none";
    return ctx.cartHasItems ? "clear-sale" : "none";
  }

  return "none";
}

/** Clasifica el elemento enfocado (solo navegador). */
export function classifyShortcutTarget(target: EventTarget | null): ShortcutTargetKind {
  const el = target as HTMLElement | null;
  if (!el || el === document.body || el === document.documentElement) return "none";
  if (typeof el.closest === "function" && el.closest("[data-pos-enter-charge]")) {
    return "charge-ok";
  }
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) {
    return "editable";
  }
  if (tag === "BUTTON" || tag === "A" || el.getAttribute?.("role") === "button") {
    return "control";
  }
  return "none";
}

/** ¿Hay un modal abierto? (VimdyModal y los modales del POS usan role=dialog). */
export function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"], [aria-modal="true"]') !== null;
}