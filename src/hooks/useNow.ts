import { useEffect, useState } from "react";

/**
 * Reloj compartido para pantallas "en vivo": devuelve `Date.now()` y se
 * actualiza cada `intervalMs`. También se corrige al instante cuando la
 * pestaña vuelve a verse (los navegadores frenan los timers en segundo plano,
 * y un cronómetro de mesa con 20 minutos de atraso sería engañoso).
 */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    tick();
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);

  return now;
}