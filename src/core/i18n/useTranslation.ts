import { useEffect, useSyncExternalStore } from "react";
import { companyConfigStore } from "../store/companyConfigStore";
import {
  dictionaryStore,
  ensureDictionary,
  getDictionary,
  spanishDictionary,
  TranslationKey
} from "./dictionaries";
import { CurrencyCode, LanguageCode } from "../config/globalization";
import { formatMoney } from "../utils/formatMoney";

/**
 * useTranslation
 * ---------------------------------------------------------------------------
 * Se suscribe al idioma Y a la moneda configurados en companyConfigStore
 * (vía useSyncExternalStore, igual que ObservableStore) y devuelve una
 * función t("clave") que traduce, además del idioma/moneda activos y un
 * helper money() ya listo para usar. Como companyConfigStore es reactivo,
 * en cuanto el negocio cambia el idioma o la moneda en Configuración,
 * cualquier componente que use este hook se re-renderiza solo, sin
 * recargar la página.
 *
 * `money` existe para que ninguna pantalla vuelva a definir su propio
 * `const money = (v) => \`$${v.toLocaleString("es-CO")}\`` fijo — ese
 * patrón (que Reportes y Clientes tenían hasta ahora) se ve perfecto en
 * Colombia y se ve mal en cualquier otro país: símbolo equivocado,
 * decimales equivocados. formatMoney() ya resuelve eso usando la moneda
 * real del negocio (src/core/utils/formatMoney.ts).
 *
 * Uso:
 *   const { t, language, currency, money } = useTranslation();
 *   <h1>{t("settings.title")}</h1>
 *   <span>{money(42000)}</span>
 */
// Empieza a bajar el idioma del negocio apenas carga la app, en paralelo,
// sin esperar a que se pinte el primer componente.
void ensureDictionary(companyConfigStore.get().language);

export function useTranslation() {
  const language = useSyncExternalStore<LanguageCode>(
    companyConfigStore.subscribe,
    () => companyConfigStore.get().language,
    () => companyConfigStore.get().language
  );

  const currency = useSyncExternalStore<CurrencyCode>(
    companyConfigStore.subscribe,
    () => companyConfigStore.get().currency,
    () => companyConfigStore.get().currency
  );

  // Se vuelve a pintar cuando termina de llegar el diccionario del idioma.
  useSyncExternalStore(dictionaryStore.subscribe, dictionaryStore.getVersion, dictionaryStore.getVersion);

  useEffect(() => {
    void ensureDictionary(language);
  }, [language]);

  function t(key: TranslationKey, vars?: Record<string, string | number>): string {
    const raw = getDictionary(language)?.[key] ?? spanishDictionary[key] ?? key;
    if (!vars) return raw;
    return Object.entries(vars).reduce(
      (acc, [name, value]) => acc.split(`{${name}}`).join(String(value)),
      raw
    );
  }

  function money(value: number): string {
    return formatMoney(value, currency, language);
  }

  return { t, language, currency, money };
}