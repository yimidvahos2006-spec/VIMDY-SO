import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";

import { MainLayout } from "../presentation/layout/MainLayout";
import { ProtectedRoute } from "../presentation/navigation/ProtectedRoute";
import { OnboardingGate } from "../presentation/navigation/OnboardingGate";
import { RequireModule } from "../presentation/navigation/RequireModule";
import { ErrorBoundary } from "../presentation/components/ui/ErrorBoundary";

import { LoginPage } from "../presentation/pages/LoginPage";
import { RegisterPage } from "../presentation/pages/RegisterPage";
import { OtpPage } from "../presentation/pages/OtpPage";
import { ForgotPasswordPage } from "../presentation/pages/ForgotPasswordPage";
import { UpdatePasswordPage } from "../presentation/pages/UpdatePasswordPage";
import { OnboardingPage } from "../presentation/pages/OnboardingPage";
import { CountrySelectionPage } from "../presentation/pages/CountrySelectionPage";
import { BusinessSelectorPage } from "../presentation/pages/BusinessSelectorPage";
import { CreateBusinessPage } from "../presentation/pages/CreateBusinessPage";
import { AuthCallbackPage } from "../presentation/pages/AuthCallbackPage";
import { RequireCountry } from "../presentation/navigation/RequireCountry";

import { LandingPage } from "../marketing/pages/LandingPage";
import { PricingPage } from "../marketing/pages/PricingPage";
import { FeaturesPage } from "../marketing/pages/FeaturesPage";
import { ContactPage } from "../marketing/pages/ContactPage";
import { PrivacyPage } from "../marketing/pages/PrivacyPage";
import { TermsPage } from "../marketing/pages/TermsPage";
import { CookiesPage } from "../marketing/pages/CookiesPage";
import { MarketingLayout } from "../marketing/components/MarketingLayout";
import { APP_URL } from "../core/config/appUrl";

function isAppSubdomain(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase();
  return hostname.startsWith("app.") || hostname === "localhost" && new URLSearchParams(window.location.search).get("app") === "1";
}

// vimdy.co (la página web) y app.vimdy.co (la app) deben quedar separados:
// vimdy.co solo sirve para mercadeo. Si alguien llega a una ruta de la app
// (login, registro, onboarding, etc.) mientras está parado en el dominio de
// mercadeo — por un link viejo, un favorito guardado, o el flujo de
// registro — esto lo manda automáticamente a la misma ruta pero en
// app.vimdy.co, en vez de dejarlo servido ahí mismo (que era el bug: la
// app entera funcionaba en los dos dominios a la vez).
function RedirectToApp() {
  if (typeof window !== "undefined") {
    window.location.replace(`${APP_URL}${window.location.pathname}${window.location.search}`);
  }
  return null;
}

// Lazy loading: cada módulo solo se descarga y se ejecuta cuando el
// usuario realmente entra a esa ruta, en vez de cargar Dashboard + POS +
// Cocina + Inventario + Reportes + Configuración todos de una vez al
// abrir la app.
const Dashboard = lazy(() =>
  import("../presentation/pages/Dashboard").then((m) => ({ default: m.Dashboard }))
);
const CashOperationsPage = lazy(() =>
  import("../presentation/pages/CashOperationsPage").then((m) => ({ default: m.CashOperationsPage }))
);
const KitchenPage = lazy(() =>
  import("../presentation/pages/KitchenPage").then((m) => ({ default: m.KitchenPage }))
);
const InventoryPage = lazy(() =>
  import("../presentation/pages/InventoryPage").then((m) => ({ default: m.InventoryPage }))
);
const ReportsPage = lazy(() =>
  import("../presentation/pages/ReportsPage").then((m) => ({ default: m.ReportsPage }))
);
const ProfitCenterPage = lazy(() =>
  import("../presentation/pages/ProfitCenterPage").then((m) => ({ default: m.ProfitCenterPage }))
);
const LossCenterPage = lazy(() =>
  import("../presentation/pages/LossCenterPage").then((m) => ({ default: m.LossCenterPage }))
);
const SmartPurchasingPage = lazy(() =>
  import("../presentation/pages/SmartPurchasingPage").then((m) => ({ default: m.SmartPurchasingPage }))
);
const ForecastPage = lazy(() =>
  import("../presentation/pages/ForecastPage").then((m) => ({ default: m.ForecastPage }))
);
const SettingsPage = lazy(() =>
  import("../presentation/pages/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);
const Meseros = lazy(() =>
  import("../presentation/pages/Meseros").then((m) => ({ default: m.Meseros }))
);
const CustomersPage = lazy(() =>
  import("../presentation/pages/CustomersPage").then((m) => ({ default: m.CustomersPage }))
);
const NotificationsPage = lazy(() =>
  import("../presentation/pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage }))
);
const CopilotPage = lazy(() =>
  import("../presentation/pages/CopilotPage").then((m) => ({ default: m.CopilotPage }))
);

function NotFoundPage() {
  return <div className="text-white p-8">404</div>;
}

/** Se muestra brevemente mientras el módulo de la ruta se descarga. */
function RouteFallback() {
  return (
    <div className="w-full h-screen flex items-center justify-center">
      <div className="w-10 h-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
    </div>
  );
}

/** Todo lo que va detrás de login: layout con sidebar + insignia de usuario. */
function AuthenticatedApp() {
  // Checklist crítico #6 — si truena SOLO un módulo (ej. Reportes), el
  // cajero no debe perder el sidebar ni tener que recargar toda la app.
  // resetKey=pathname: en cuanto navega a otra pantalla, el boundary se
  // limpia solo — no necesita "Reintentar" para que vuelva a intentarlo la
  // próxima vez que entre a ese módulo.
  const { pathname } = useLocation();

  return (
    <ProtectedRoute>
      {/* PASO 1 del onboarding inteligente: mientras el negocio no haya
          terminado la configuración inicial, ninguna ruta de acá abajo
          (Dashboard, Caja, Cocina...) se muestra — se redirige a /onboarding. */}
      <OnboardingGate>
        <MainLayout>
          <ErrorBoundary scope="route" resetKey={pathname}>
            <Suspense fallback={<RouteFallback />}>
              <Routes>

              <Route
                path="/"
                element={<Navigate to="/dashboard" replace />}
              />

              <Route
                path="/dashboard"
                element={<Dashboard />}
              />

              <Route
                path="/caja"
                element={
                  <ProtectedRoute requires="cash.view">
                    <RequireModule module="caja">
                      <CashOperationsPage />
                    </RequireModule>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/cocina"
                element={
                  <RequireModule module="cocina">
                    <KitchenPage />
                  </RequireModule>
                }
              />

              <Route
                path="/meseros"
                element={
                  <ProtectedRoute requires="tables.view">
                    <RequireModule module="mesas">
                      <Meseros />
                    </RequireModule>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/inventario"
                element={
                  <ProtectedRoute requires="inventory.view">
                    <RequireModule module="inventario">
                      <InventoryPage />
                    </RequireModule>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/clientes"
                element={
                  <ProtectedRoute requires="customers.view">
                    <RequireModule module="clientes">
                      <CustomersPage />
                    </RequireModule>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/notificaciones"
                element={<NotificationsPage />}
              />

              <Route
                path="/reportes"
                element={
                  <ProtectedRoute requires="reports.view">
                    <ReportsPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/ganancias"
                element={
                  <ProtectedRoute requires="reports.view">
                    <ProfitCenterPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/perdidas"
                element={
                  <ProtectedRoute requires="reports.view">
                    <LossCenterPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/compras-inteligentes"
                element={
                  <ProtectedRoute requires="reports.view">
                    <SmartPurchasingPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/pronostico"
                element={
                  <ProtectedRoute requires="reports.view">
                    <ForecastPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/configuracion"
                element={
                  <ProtectedRoute requires="company.settings">
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/ia"
                element={
                  <ProtectedRoute requires="reports.view">
                    <RequireModule module="ia">
                      <CopilotPage />
                    </RequireModule>
                  </ProtectedRoute>
                }
              />

              <Route
                path="*"
                element={<NotFoundPage />}
              />

              </Routes>
            </Suspense>
          </ErrorBoundary>
        </MainLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export function App() {
  if (isAppSubdomain()) {
    return (
      <Routes>
        <Route path="/pais" element={<CountrySelectionPage />} />
        <Route
          path="/login"
          element={
            <RequireCountry>
              <LoginPage />
            </RequireCountry>
          }
        />
        <Route
          path="/registro"
          element={
            <RequireCountry>
              <RegisterPage />
            </RequireCountry>
          }
        />
        <Route
          path="/verificar-codigo"
          element={
            <RequireCountry>
              <OtpPage />
            </RequireCountry>
          }
        />
        <Route
          path="/recuperar-password"
          element={
            <RequireCountry>
              <ForgotPasswordPage />
            </RequireCountry>
          }
        />
        <Route
          path="/actualizar-password"
          element={
            <RequireCountry>
              <UpdatePasswordPage />
            </RequireCountry>
          }
        />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute>
              <OnboardingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/business-selector"
          element={
            <ProtectedRoute>
              <BusinessSelectorPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/crear-negocio"
          element={
            <ProtectedRoute>
              <CreateBusinessPage />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/*" element={<AuthenticatedApp />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Selector de país — primer paso obligatorio para cualquier
          dispositivo nuevo, antes que login o registro. Elegir un país acá
          autoconfigura idioma + moneda + hora de toda la app al instante
          (ver companyConfigStore.markCountrySelected). No lleva
          RequireCountry: es la propia pantalla a la que ese guard redirige. */}
      {/* Rutas de la app: vimdy.co (mercadeo) nunca las sirve él mismo —
          rebota de una a app.vimdy.co conservando la misma ruta. */}
      <Route path="/pais" element={<RedirectToApp />} />
      <Route path="/login" element={<RedirectToApp />} />
      <Route path="/registro" element={<RedirectToApp />} />
      <Route path="/verificar-codigo" element={<RedirectToApp />} />
      <Route path="/recuperar-password" element={<RedirectToApp />} />
      <Route path="/actualizar-password" element={<RedirectToApp />} />
      <Route path="/auth/callback" element={<RedirectToApp />} />
      <Route path="/onboarding" element={<RedirectToApp />} />
      <Route path="/business-selector" element={<RedirectToApp />} />
      <Route path="/crear-negocio" element={<RedirectToApp />} />

      {/* Marketing público — sin autenticación, sin MainLayout */}
      <Route element={<MarketingLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/precios" element={<PricingPage />} />
        <Route path="/funciones" element={<FeaturesPage />} />
        <Route path="/contacto" element={<ContactPage />} />
        <Route path="/privacidad" element={<PrivacyPage />} />
        <Route path="/terminos" element={<TermsPage />} />
        <Route path="/cookies" element={<CookiesPage />} />
      </Route>

      {/* Cualquier otra ruta desconocida en vimdy.co (por ejemplo, un
          deep link viejo hacia una pantalla de la app) también rebota a
          app.vimdy.co en vez de mostrar la app ahí mismo. */}
      <Route path="/*" element={<RedirectToApp />} />
    </Routes>
  );
}
