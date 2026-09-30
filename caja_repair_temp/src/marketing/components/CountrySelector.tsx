import { Globe, ChevronDown } from "lucide-react";
import { useState, useMemo } from "react";
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
  "VE"
];

export function CountrySelector() {
  const [open, setOpen] = useState(false);
  const country = useSyncExternalStore(companyConfigStore.subscribe, () => companyConfigStore.get().country);
  const language = useSyncExternalStore(companyConfigStore.subscribe, () => companyConfigStore.get().language) as LanguageCode;

  const label = useMemo(() => getCountryName(country, language), [country, language]);

  function handleChange(code: CountryCode) {
    companyConfigStore.update({ country: code });
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 text-sm text-zinc-300 transition-colors"
      >
        <Globe size={16} className="text-zinc-400" />
        <span>{label}</span>
        <ChevronDown size={14} className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-48 bg-[#111114] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
            {AVAILABLE_COUNTRIES.map((code) => (
              <button
                key={code}
                onClick={() => handleChange(code)}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                  code === country
                    ? "bg-blue-600/20 text-blue-300"
                    : "text-zinc-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                {getCountryName(code, language)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
