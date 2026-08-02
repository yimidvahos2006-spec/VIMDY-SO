import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './routes/App';
import { AuthProvider } from './presentation/context/AuthContext';
import { ToastContainer } from './presentation/components/ui/ToastContainer';
import { ErrorBoundary } from './presentation/components/ui/ErrorBoundary';

import './styles/index.css';

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