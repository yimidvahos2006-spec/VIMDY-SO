import React, {
  useRef,
  useState,
  useEffect
} from "react";

import {
  Search,
  X,
  Mic,
  Loader2,
  Users
} from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { useSearch } from "../../../core/store/useSearch";
import { useCart } from "../../../core/store/useCart";
import { useProductCatalog } from "../../../core/store/useProductCatalog";
import { useEnabledModules } from "../../../core/store/useEnabledModules";
import { toastStore } from "../../../core/store/toastStore";
import { weightEntryStore } from "../../../core/store/weightEntryStore";
import { isVariableQuantityUnit } from "../../../core/utils/weightUnits";
import { startSpeechRecognition } from "../../../core/voice/speechRecognition";
import { processVoice } from "../../../core/voice/voiceProcessor";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { PosTableSearchModal } from "./PosTableSearchModal";

export function PosTopBar() {

  const { t } = useTranslation();

  const inputRef = useRef<HTMLInputElement>(null);

  const {
    value: search,
    update: setSearch,
    clear: clearSearch
  } = useSearch();

  const { add } = useCart();
  const { getByBarcode } = useProductCatalog();
  const enabledModules = useEnabledModules();
  const hasTablesModule = (enabledModules ?? []).includes("mesas");

  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  // Buscar/cobrar una mesa desde Caja (cliente que se paró del restaurante
  // y va directo al mostrador a pagar, sin pasar por Meseros).
  const [showTableCharge, setShowTableCharge] = useState(false);

  useEffect(() => {

    function handleKey(event: KeyboardEvent) {

      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }

      if (event.key === "Escape") {
        clearSearch();
      }

    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);

  }, [clearSearch]);

  /**
   * Escaneo rápido: un lector de código de barras escribe el código y
   * manda Enter automáticamente. Antes esto solo filtraba la grilla y el
   * cajero igual tenía que tocar la tarjeta — un paso de más por cada
   * producto en un mostrador con lector físico. Ahora, si el texto
   * coincide EXACTO con el código de barras de un producto, se agrega
   * directo al carrito y se limpia la búsqueda, lista para el siguiente
   * escaneo — cero toques adicionales.
   */
  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;

    const code = search.trim();
    if (!code) return;

    const product = getByBarcode(code);

    if (!product) {
      // No es necesariamente un error: puede ser una búsqueda normal por
      // nombre que el cajero está afinando. Solo se avisa si el texto
      // tiene pinta de código de barras (todo dígitos) para no molestar
      // con un toast en cada Enter de una búsqueda por texto.
      if (/^\d+$/.test(code)) {
        toastStore.warning(t("pos.topbar.barcodeNotFound", { code }));
      }
      return;
    }

    // PASO 2 (formulario de producto — Estado): un producto marcado
    // "Agotado" a mano (product.active === false) tampoco se puede agregar
    // escaneando su código de barras, igual que uno sin stock.
    //
    // BLOQUEANTE (bug reportado en video 2026-07-31): trackStock === false
    // (Cocina sin receta, ej. Caldo de Costilla) no maneja stock propio y
    // nace en 0 a propósito — sin este chequeo, escanear su código de
    // barras lo rechazaba con "sin stock" para siempre. Mismo criterio que
    // PosProducts.tsx (ProductCard.available).
    if ((product.stock <= 0 && product.trackStock !== false) || product.active === false) {
      toastStore.warning(t("pos.topbar.barcodeOutOfStock", { name: product.name }));
      return;
    }

    // BLOQUEANTE (auditoría Fase 2 — Supermercado): un producto vendido por
    // peso/volumen (Product.unit ∈ kg/g/libra/litro/ml) no se puede agregar
    // con cantidad 1 fija — hay que pesarlo primero. Ver
    // core/utils/weightUnits.ts y PosWeightEntryModal.tsx.
    if (isVariableQuantityUnit(product.unit)) {
      weightEntryStore.open({
        id: product.id,
        name: product.name,
        price: product.price,
        unit: product.unit as string,
        requiresKitchen: product.requiresKitchen ?? true
      });
      clearSearch();
      return;
    }

    add({ id: product.id, name: product.name, price: product.price, requiresKitchen: product.requiresKitchen ?? true });
    clearSearch();
  }

  async function handleVoice() {

    setListening(true);

    const speech = await startSpeechRecognition();

    setListening(false);

    if (speech.success) {

      setProcessing(true);

      // Un giro breve de ~1s mientras se interpreta el comando, para que
      // el cajero vea que VIMDY está "pensando" y no que se quedó pegado.
      await new Promise((resolve) => setTimeout(resolve, 1000));

      processVoice(speech.text);

      setProcessing(false);

    }

  }

  return (

    <div className="flex items-center gap-4 bg-vimdy-surface border border-vimdy-border rounded-vimdy-lg pl-5 pr-[230px] py-3 flex-shrink-0">

      <div className="min-w-fit">
        <div className="flex items-center gap-2">
          <h1 className="text-vimdy-h3 font-bold text-vimdy-text whitespace-nowrap">
            {t("pos.topbar.title")}
          </h1>
          <span className="flex items-center gap-1.5 text-vimdy-micro text-vimdy-success bg-vimdy-success-bg border border-vimdy-success/20 px-2 py-1 rounded-full whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-vimdy-success" />
            {t("pos.topbar.register")}
          </span>
        </div>
      </div>

      <div className="flex-1 flex items-center h-11 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface-active px-4 transition-colors focus-within:border-vimdy-accent">

        <Search size={18} className="text-vimdy-text-secondary flex-shrink-0" />

        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t("pos.topbar.searchPlaceholder")}
          className="flex-1 ml-3 bg-transparent outline-none text-vimdy-text text-vimdy-small placeholder:text-vimdy-text-tertiary"
        />

        {
          search
            ? (
              <button
                onClick={clearSearch}
                aria-label={t("pos.topbar.clearSearchAria")}
                className="w-8 h-8 flex items-center justify-center text-vimdy-text-secondary hover:text-vimdy-text flex-shrink-0 transition-colors"
              >
                <X size={16} />
              </button>
            )
            : (
              <span className="px-2 py-0.5 rounded-vimdy-xs bg-vimdy-surface text-vimdy-text-tertiary text-vimdy-micro flex-shrink-0">
                Ctrl + K
              </span>
            )
        }

      </div>

      {hasTablesModule && (
        <div className="flex-shrink-0">
          <VimdyButton
            onClick={() => setShowTableCharge(true)}
            variant="secondary"
            size="lg"
            icon={<Users size={18} className="text-vimdy-accent" />}
          >
            {t("pos.topbar.chargeByTable")}
          </VimdyButton>
        </div>
      )}

      <button
        onClick={handleVoice}
        disabled={listening || processing}
        className={`
          flex items-center gap-2 h-11 px-4 rounded-vimdy-md border transition-all duration-vimdy-normal flex-shrink-0

          ${
            listening
              ? "bg-vimdy-accent/10 border-vimdy-accent"
              : processing
              ? "bg-vimdy-accent/10 border-vimdy-accent"
              : "bg-vimdy-surface-active border-vimdy-border hover:border-vimdy-accent animate-voice-idle-glow"
          }
        `}
      >

        {
          processing
            ? <Loader2 size={18} className="text-vimdy-accent flex-shrink-0 animate-vimdy-spin" />
            : <Mic size={18} className="text-vimdy-accent flex-shrink-0" />
        }

        <span className="text-vimdy-text text-vimdy-small font-semibold whitespace-nowrap">
          VIMDY Voice
        </span>

        {
          listening && (
            <span className="flex items-end gap-[3px] h-3 ml-1">
              <span className="w-[2.5px] h-full bg-vimdy-accent/80 rounded-full animate-voice-bar-1" />
              <span className="w-[2.5px] h-full bg-vimdy-accent/80 rounded-full animate-voice-bar-2" />
              <span className="w-[2.5px] h-full bg-vimdy-accent/80 rounded-full animate-voice-bar-3" />
              <span className="w-[2.5px] h-full bg-vimdy-accent/80 rounded-full animate-voice-bar-4" />
            </span>
          )
        }

      </button>

      {showTableCharge && (
        <PosTableSearchModal onClose={() => setShowTableCharge(false)} />
      )}

    </div>

  );

}