import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Globe } from "lucide-react";
import { useSyncExternalStore } from "react";
import { companyConfigStore } from "../../core/store/companyConfigStore";
import { getCountryName } from "../../core/config/globalization";
import type { CountryCode, LanguageCode } from "../../core/config/globalization";

const AVAILABLE_COUNTRIES: CountryCode[] = [
  "CO",
  "MX",
  "PE",
  "CL",
  "AR",
  "ES",
  "EC",
  "PA",
  "US",
  "VE",
];

export function CountrySelector() {
  const [open, setOpen] = useState(false);
  const menuId = useId().replace(/:/g, "");
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const country = useSyncExternalStore(
    companyConfigStore.subscribe,
    () => companyConfigStore.get().country,
  );
  const language = useSyncExternalStore(
    companyConfigStore.subscribe,
    () => companyConfigStore.get().language,
  ) as LanguageCode;

  const label = useMemo(
    () => getCountryName(country, language),
    [country, language],
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!wrapperRef.current?.contains(target)) setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleChange(code: CountryCode) {
    companyConfigStore.update({ country: code });
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 transition-[background-color,border-color,color] duration-300 hover:border-white/20 hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070a]"
      >
        <Globe size={16} className="shrink-0 text-zinc-400" aria-hidden="true" />
        <span className="max-w-28 truncate">{label}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-zinc-500 transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Seleccionar país"
          className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0b0e13]/95 p-1 shadow-[0_20px_60px_rgba(0,0,0,0.4)] backdrop-blur-2xl"
        >
          {AVAILABLE_COUNTRIES.map((code) => {
            const selected = code === country;

            return (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => handleChange(code)}
                className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/45 ${
                  selected
                    ? "bg-cyan-300/[0.08] text-cyan-100"
                    : "text-zinc-300 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <span>{getCountryName(code, language)}</span>
                {selected && (
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.55)]"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}