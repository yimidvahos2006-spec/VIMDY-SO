import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './routes/App';
import { AuthProvider } from './presentation/context/AuthContext';
import { ToastContainer } from './presentation/components/ui/ToastContainer';
import { ConfirmHost } from './presentation/components/ui/ConfirmHost';
import { ErrorBoundary } from './presentation/components/ui/ErrorBoundary';
import { installGlobalErrorHandlers } from './infrastructure/logging/globalErrorHandlers';
import { reloadOnceForNewDeploy } from './core/utils/lazyWithRetry';

import './styles/index.css';

// Sentry pesa ~275 kB: se carga DESPUÉS de pintar la app (y solo si hay DSN),
// para que no retrase la primera pantalla.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN ?? '';
if (sentryDsn) {
  const startSentry = () => {
    void import('@sentry/react').then((Sentry) => {
      Sentry.init({
        dsn: sentryDsn,
        environment: import.meta.env.MODE,
        integrations: [
          Sentry.browserTracingIntegration(),
          Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })
        ],
        tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
        replaysSessionSampleRate: import.meta.env.PROD ? 0.1 : 0.5,
        replaysOnErrorSampleRate: 1.0,
        enabled: true
      });
    });
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(startSentry, { timeout: 4000 });
  } else {
    window.setTimeout(startSentry, 2000);
  }
}

// Complementa a ErrorBoundary (que solo atrapa errores de render): captura
// errores sueltos (onClick, async sin catch, promesas rechazadas) para que
// también lleguen a system_errors. Ver globalErrorHandlers.ts.
installGlobalErrorHandlers();

// Vite dispara este evento cuando falla la precarga de un chunk (típico tras un
// deploy nuevo con la pestaña abierta). Recarga una sola vez para traer los
// hashes vigentes; la guardia anti-bucle vive en reloadOnceForNewDeploy().
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnceForNewDeploy()) event.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        {/* Checklist crítico #6 — red de seguridad final: si algo revienta
            en cualquier parte de la app (incluso el propio enrutador),
            esto evita la pantalla en blanco total. Va DENTRO de
            AuthProvider para poder auditar el crash con el usuario
            logueado, y DENTRO de BrowserRouter para poder ofrecer
            "Ir al Dashboard" en el fallback por ruta que envuelve
            routes/App.tsx. */}
        <ErrorBoundary scope="app">
          <App />
        </ErrorBoundary>
      </AuthProvider>
      <ToastContainer />
      <ConfirmHost />
    </BrowserRouter>
  </React.StrictMode>
);