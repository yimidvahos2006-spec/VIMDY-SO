import React, {
  useRef,
  useState,
  useEffect
} from "react";

import {
  Search,
  X,
  Users
} from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { useSearch } from "../../../core/store/useSearch";
import { useCart } from "../../../core/store/useCart";
import { useProductCatalog } from "../../../core/store/useProductCatalog";
import { useCanUse } from "../../../hooks/useCanUse";
import { toastStore } from "../../../core/store/toastStore";
import { weightEntryStore } from "../../../core/store/weightEntryStore";
import { variantSelectorStore } from "../../../core/store/variantSelectorStore";
import { isVariableQuantityUnit } from "../../../core/utils/weightUnits";
import { useVoiceOrderSession, type VoiceAddLine } from "../../../core/voice/useVoiceOrderSession";
import type { Product } from "../../../core/entities/Entities";
import { VoiceOrderButton } from "../voice/VoiceOrderButton";
import { VoiceOrderPanel } from "../voice/VoiceOrderPanel";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { PosTableSearchModal } from "./PosTableSearchModal";
import { isModalOpen } from "./posShortcuts";

export function PosTopBar() {

  const { t } = useTranslation();

  const inputRef = useRef<HTMLInputElement>(null);

  const {
    value: search,
    update: setSearch,
    clear: clearSearch
  } = useSearch();

  const { add } = useCart();
  const { getByBarcode, products } = useProductCatalog();
  const hasTablesModule = useCanUse("tables");

  const [showTableCharge, setShowTableCharge] = useState(false);

  /**
   * VIMDY Voice en Caja: mismas reglas que el escáner de código de barras
   * (peso, tamaños y aviso de stock) para que dictar y escanear se comporten igual.
   */
  function addVoiceLines(lines: VoiceAddLine<Product>[]) {
    const needsInput: Product[] = [];

    for (const { product, quantity, note } of lines) {
      if (isVariableQuantityUnit(product.unit) || variantSelectorStore.needsSelector(product)) {
        needsInput.push(product);
        continue;
      }

      if (product.stock <= 0 && product.trackStock !== false) {
        toastStore.warning(t("pos.topbar.barcodeNegativeStock", { name: product.name }));
      }

      add({
        id: product.id,
        name: product.name,
        price: product.price,
        requiresKitchen: product.requiresKitchen ?? false,
        quantity,
        note
      });
    }

    // Los selectores son de uno en uno: se abre el primero y se avisa de los demás.
    const [first, ...rest] = needsInput;
    if (!first) return;

    if (isVariableQuantityUnit(first.unit)) {
      weightEntryStore.open({
        id: first.id,
        name: first.name,
        price: first.price,
        unit: first.unit as string,
        requiresKitchen: first.requiresKitchen ?? false
      });
    } else {
      variantSelectorStore.open({
        id: first.id,
        name: first.name,
        price: first.price,
        requiresKitchen: first.requiresKitchen ?? false,
        sizes: first.sizes,
        extras: first.extras
      });
    }

    toastStore.info(
      rest.length > 0
        ? `Elige el peso o tamaño de ${first.name}. Después dicta de nuevo: ${rest.map(p => p.name).join(", ")}.`
        : `Elige el peso o tamaño de ${first.name}.`
    );
  }

  const voice = useVoiceOrderSession<Product>({
    products,
    onAddLines: addVoiceLines,
    // Las mesas se atienden desde Meseros: no se mezcla un pedido de mesa con la venta de Caja.
    checkTable: (tableNumber) =>
      `Dijiste “mesa ${tableNumber}”. Los pedidos de mesa se toman en Meseros; en Caja di solo los productos.`
  });

  useEffect(() => {

    function handleKey(event: KeyboardEvent) {

      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }

      // F2: saltar al buscador sin tocar el mouse (hora pico).
      if (event.key === "F2" && !event.ctrlKey && !event.metaKey && !event.altKey && !isModalOpen()) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }

      // Esc: limpia la búsqueda. Si ya está vacía, PosSalePanel limpia la venta.
      if (event.key === "Escape" && !isModalOpen()) {
        clearSearch();
      }

    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);

  }, [clearSearch]);

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;

    const code = search.trim();
    if (!code) return;

    const product = getByBarcode(code);

    if (!product) {
      if (/^\d+$/.test(code)) {
        toastStore.warning(t("pos.topbar.barcodeNotFound", { code }));
      }
      return;
    }

    if (product.active === false) {
      toastStore.warning(t("pos.topbar.barcodeOutOfStock", { name: product.name }));
      return;
    }

    // Opción B: sin stock NO bloquea la venta. Se avisa y se agrega igual; el
    // inventario queda en negativo y el Kardex lo marca para auditarlo después.
    if (product.stock <= 0 && product.trackStock !== false) {
      toastStore.warning(t("pos.topbar.barcodeNegativeStock", { name: product.name }));
    }

    if (isVariableQuantityUnit(product.unit)) {
      weightEntryStore.open({
        id: product.id,
        name: product.name,
        price: product.price,
        unit: product.unit as string,
        requiresKitchen: product.requiresKitchen ?? false
      });
      clearSearch();
      return;
    }

    if (variantSelectorStore.needsSelector(product)) {
      variantSelectorStore.open({
        id: product.id,
        name: product.name,
        price: product.price,
        requiresKitchen: product.requiresKitchen ?? false,
        sizes: product.sizes,
        extras: product.extras
      });
      clearSearch();
      return;
    }

    add({ id: product.id, name: product.name, price: product.price, requiresKitchen: product.requiresKitchen ?? false });
    clearSearch();
  }

  return (

    <div className="flex items-center gap-4 bg-vimdy-surface border border-vimdy-border rounded-vimdy-lg pl-5 pr-[230px] py-3 flex-shrink-0 relative">

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

      <VoiceOrderButton session={voice} />

      <VoiceOrderPanel
        session={voice}
        hint="Di: “dos cervezas águila light y una bandeja paisa sin arroz”"
        className="absolute right-5 top-full mt-2 z-[900] w-[min(92vw,380px)]"
      />

      {showTableCharge && (
        <PosTableSearchModal onClose={() => setShowTableCharge(false)} />
      )}

    </div>

  );

}