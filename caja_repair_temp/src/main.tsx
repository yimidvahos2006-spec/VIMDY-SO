import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';

import { App } from './routes/App';
import { AuthProvider } from './presentation/context/AuthContext';
import { ToastContainer } from './presentation/components/ui/ToastContainer';
import { ErrorBoundary } from './presentation/components/ui/ErrorBoundary';
import { installGlobalErrorHandlers } from './infrastructure/logging/globalErrorHandlers';

import './styles/index.css';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN ?? '',
  environment: import.meta.env.MODE,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false })
  ],
  tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
  replaysSessionSampleRate: import.meta.env.PROD ? 0.1 : 0.5,
  replaysOnErrorSampleRate: 1.0,
  enabled: Boolean(import.meta.env.VITE_SENTRY_DSN)
});

// Complementa a ErrorBoundary (que solo atrapa errores de render): captura
// errores sueltos (onClick, async sin catch, promesas rechazadas) para que
// también lleguen a system_errors. Ver globalErrorHandlers.ts.
installGlobalErrorHandlers();

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
    </BrowserRouter>
  </React.StrictMode>
);