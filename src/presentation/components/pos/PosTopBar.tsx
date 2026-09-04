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
  Users,
  CheckCircle2
} from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { useSearch } from "../../../core/store/useSearch";
import { useCart } from "../../../core/store/useCart";
import { useProductCatalog } from "../../../core/store/useProductCatalog";
import { useEnabledModules } from "../../../core/store/useEnabledModules";
import { toastStore } from "../../../core/store/toastStore";
import { weightEntryStore } from "../../../core/store/weightEntryStore";
import { variantSelectorStore } from "../../../core/store/variantSelectorStore";
import { isVariableQuantityUnit } from "../../../core/utils/weightUnits";
import { useVoiceOrder } from "../../../core/voice/useVoiceOrder";
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

  const [processing, setProcessing] = useState(false);
  const [voiceSuccess, setVoiceSuccess] = useState<string | null>(null);
  const [showTableCharge, setShowTableCharge] = useState(false);

  const { listening, listen } = useVoiceOrder({
    onSuccess: (voiceResult) => {
      if (voiceResult.added.length > 0) {
        setVoiceSuccess(voiceResult.added.join(", "));
        setTimeout(() => setVoiceSuccess(null), 3000);
      }
    },
    onError: (error) => {
      toastStore.warning(error);
    }
  });

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

    if ((product.stock <= 0 && product.trackStock !== false) || product.active === false) {
      toastStore.warning(t("pos.topbar.barcodeOutOfStock", { name: product.name }));
      return;
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

  async function handleVoice() {

    setProcessing(true);

    await listen();

    setProcessing(false);

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

      <button
        onClick={handleVoice}
        disabled={listening || processing}
        className={`
          flex items-center gap-2 h-11 px-4 rounded-vimdy-md border transition-all duration-vimdy-normal flex-shrink-0

          ${
            listening || processing
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

      {voiceSuccess && (
        <div className="absolute -bottom-10 left-5 flex items-center gap-2 text-emerald-400 text-xs font-semibold bg-emerald-500/10 border border-emerald-500/40 px-3 py-1.5 rounded-lg">
          <CheckCircle2 size={14} />
          {voiceSuccess}
        </div>
      )}

      {showTableCharge && (
        <PosTableSearchModal onClose={() => setShowTableCharge(false)} />
      )}

    </div>

  );

}
