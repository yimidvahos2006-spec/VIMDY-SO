import React from "react";
import { AlertTriangle, RotateCcw, RefreshCcw, Home } from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { logError } from "../../../infrastructure/logging/opsLogger";
import { container } from "../../../infrastructure/di/CompositionRoot";

/**
 * ErrorBoundary.tsx
 * ---------------------------------------------------------------------------
 * Checklist crítico #6 — hoy si algo truena en un componente, React
 * desmonta TODO el árbol y la pantalla queda en blanco sin ningún aviso ni
 * salida. Un cajero a las 8pm un viernes, a mitad de un cobro, no puede
 * quedarse con pantalla en blanco sin poder hacer nada.
 *
 * Este archivo define UN solo componente reutilizable (`ErrorBoundary`) que
 * se usa en DOS niveles distintos (ver main.tsx y routes/App.tsx):
 *
 *   1) GLOBAL (main.tsx, envolviendo <App/>): red de seguridad final. Si
 *      algo revienta en cualquier parte de la app — incluso en el propio
 *      enrutador — esto evita la pantalla en blanco total y ofrece
 *      "Recargar la aplicación".
 *
 *   2) POR RUTA (routes/App.tsx, envolviendo <Routes/> dentro del layout
 *      autenticado): si lo que truena es SOLO un módulo (ej. Reportes), el
 *      cajero no pierde el sidebar ni tiene que recargar todo — puede darle
 *      "Reintentar" o navegar a otro módulo, y basta con eso para
 *      recuperarse (ver resetKey más abajo).
 *
 * DISEÑO: React solo permite capturar errores de renderizado con un
 * componente de CLASE (getDerivedStateFromError / componentDidCatch — no
 * existe equivalente en hooks todavía). Por eso el núcleo es una clase
 * (`ErrorBoundaryClass`), pero se expone envuelto en un componente función
 * (`ErrorBoundary`) para poder leer el usuario actual con `useAuth()` y
 * dejarlo en el registro de auditoría del crash, igual que cualquier otra
 * acción real del sistema.
 */

interface ErrorBoundaryClassProps {
  children: React.ReactNode;
  /** Ver AppErrorFallback más abajo — cambia el texto/nivel del mensaje. */
  scope: "app" | "route";
  /** id del cajero/usuario logueado, si hay sesión — solo para auditoría. */
  actorId?: string;
  /**
   * Si este valor cambia mientras hay un error activo, el boundary se
   * resetea solo (ej. la ruta cambió — ya no tiene sentido seguir mostrando
   * el error de la página anterior).
   */
  resetKey?: string;
}

interface ErrorBoundaryClassState {
  error: Error | null;
}

class ErrorBoundaryClass extends React.Component<ErrorBoundaryClassProps, ErrorBoundaryClassState> {
  state: ErrorBoundaryClassState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryClassState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Manda a system_errors (ver opsLogger.ts) — este es el punto más
    // importante de todos para loguear, porque atrapa CUALQUIER crash no
    // controlado de cualquier parte de la app, no solo los que alguien se
    // acordó de envolver en try/catch.
    logError(error, {
      category: "unknown",
      context: { scope: this.props.scope, componentStack: info.componentStack?.slice(0, 2000) }
    });

    // Mejor esfuerzo: deja rastro en auditoría para poder revisar después
    // qué tronó y a quién le pasó. Va envuelto en su propio try/catch y
    // NUNCA debe poder tumbar el fallback de abajo — si el negocio ni
    // siquiera tiene contexto (crash antes de terminar el login), esto
    // simplemente se ignora en silencio.
    void this.logCrash(error, info).catch(() => {
      /* intencional: un fallo registrando el crash no puede ocultar el fallback */
    });
  }

  componentDidUpdate(prevProps: ErrorBoundaryClassProps): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  private async logCrash(error: Error, info: React.ErrorInfo): Promise<void> {
    await container.auditEngine.get().log(
      this.props.actorId ?? "system",
      "APP_CRASH",
      "system",
      `[${this.props.scope}] ${error.message} — ${info.componentStack?.trim().split("\n")[0] ?? ""}`.slice(0, 500)
    );
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <AppErrorFallback
          error={this.state.error}
          scope={this.props.scope}
          onRetry={this.reset}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * Pantalla de recuperación. Sigue la guía de docs/02_DESIGN_SYSTEM/16 —
 * Problema -> Consecuencia -> Solución, en español humano, sin nada técnico
 * a la vista salvo el detalle colapsado para soporte.
 */
function AppErrorFallback({
  error,
  scope,
  onRetry
}: {
  error: Error;
  scope: "app" | "route";
  onRetry: () => void;
}) {
  const isRoute = scope === "route";

  return (
    <div
      className={
        isRoute
          ? "w-full min-h-[60vh] flex items-center justify-center p-6"
          : "fixed inset-0 z-[2000] bg-slate-950 flex items-center justify-center p-6"
      }
    >
      <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-slate-900 shadow-vimdy-lg p-6 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4">
          <AlertTriangle size={26} className="text-red-400" />
        </div>

        <h2 className="text-white font-bold text-lg mb-1.5">
          {isRoute ? "Este módulo tuvo un problema." : "VIMDY tuvo un problema inesperado."}
        </h2>

        <p className="text-slate-400 text-sm mb-6">
          {isRoute
            ? "No se pudo mostrar esta pantalla, pero el resto de la app sigue funcionando."
            : "La aplicación no pudo continuar. Tu venta o turno de caja NO se pierde: queda guardado en el servidor."}
        </p>

        <div className="flex flex-col gap-2.5">
          <button
            onClick={onRetry}
            className="h-11 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold flex items-center justify-center gap-2 transition-colors"
          >
            <RotateCcw size={17} />
            Reintentar
          </button>

          {isRoute ? (
            <a
              href="/dashboard"
              className="h-11 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Home size={17} />
              Ir al Dashboard
            </a>
          ) : (
            <button
              onClick={() => window.location.reload()}
              className="h-11 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <RefreshCcw size={17} />
              Recargar la aplicación
            </button>
          )}
        </div>

        <details className="mt-5 text-left">
          <summary className="text-slate-600 text-xs cursor-pointer hover:text-slate-500">
            Detalle técnico
          </summary>
          <pre className="mt-2 text-[11px] leading-relaxed text-slate-500 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
            {error.message}
          </pre>
        </details>
      </div>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * "app" (default) = red de seguridad global, pantalla completa, botón de
   * "Recargar la aplicación". "route" = un solo módulo, conserva el resto
   * del layout, botón de "Ir al Dashboard".
   */
  scope?: "app" | "route";
  resetKey?: string;
}

/**
 * Envoltorio público. Lee el usuario logueado (si lo hay) para dejarlo en
 * el registro de auditoría del crash. Requiere estar dentro de
 * <AuthProvider> — así se usa en los dos puntos de montaje de esta app
 * (main.tsx y routes/App.tsx), ambos ya están dentro de AuthProvider.
 */
export function ErrorBoundary({ children, scope = "app", resetKey }: ErrorBoundaryProps) {
  const { user } = useAuth();

  return (
    <ErrorBoundaryClass scope={scope} actorId={user?.id} resetKey={resetKey}>
      {children}
    </ErrorBoundaryClass>
  );
}