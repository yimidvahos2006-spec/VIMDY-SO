import { Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";

import { MainLayout } from "../presentation/layout/MainLayout";
import { ProtectedRoute } from "../presentation/navigation/ProtectedRoute";
import { OnboardingGate } from "../presentation/navigation/OnboardingGate";
import { RequireModule } from "../presentation/navigation/RequireModule";
import { DashboardGate, RoleHomeRedirect } from "../presentation/navigation/RoleHome";
import { ROUTE_PERMISSIONS } from "../core/config/roleAccess";
import { ErrorBoundary } from "../presentation/components/ui/ErrorBoundary";

import { LoginPage } from "../presentation/pages/LoginPage";
import { RequireCountry } from "../presentation/navigation/RequireCountry";

import { APP_URL } from "../core/config/appUrl";
import { lazyWithRetry } from "../core/utils/lazyWithRetry";

function isAppSubdomain(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase();
  const previewAppEnabled = import.meta.env.VITE_ENABLE_PREVIEW_APP === "true";
  return hostname.startsWith("app.") || previewAppEnabled || (hostname === "localhost" && new URLSearchParams(window.location.search).get("app") === "1");
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
    window.location.replace(`${APP_URL}${window.location.pathname}${window.location.search}${window.location.hash}`);
  }
  return null;
}

// Pantallas de acceso: se cargan solo cuando el usuario entra a ellas
// (LoginPage queda en el paquete principal porque es la primera pantalla).
const RegisterPage = lazyWithRetry(() =>
  import("../presentation/pages/RegisterPage").then((m) => ({ default: m.RegisterPage }))
);
const OtpPage = lazyWithRetry(() =>
  import("../presentation/pages/OtpPage").then((m) => ({ default: m.OtpPage }))
);
const ForgotPasswordPage = lazyWithRetry(() =>
  import("../presentation/pages/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage }))
);
const UpdatePasswordPage = lazyWithRetry(() =>
  import("../presentation/pages/UpdatePasswordPage").then((m) => ({ default: m.UpdatePasswordPage }))
);
const OnboardingPage = lazyWithRetry(() =>
  import("../presentation/pages/OnboardingPage").then((m) => ({ default: m.OnboardingPage }))
);
const CountrySelectionPage = lazyWithRetry(() =>
  import("../presentation/pages/CountrySelectionPage").then((m) => ({ default: m.CountrySelectionPage }))
);
const BusinessSelectorPage = lazyWithRetry(() =>
  import("../presentation/pages/BusinessSelectorPage").then((m) => ({ default: m.BusinessSelectorPage }))
);
const CreateBusinessPage = lazyWithRetry(() =>
  import("../presentation/pages/CreateBusinessPage").then((m) => ({ default: m.CreateBusinessPage }))
);
const AuthCallbackPage = lazyWithRetry(() =>
  import("../presentation/pages/AuthCallbackPage").then((m) => ({ default: m.AuthCallbackPage }))
);

// Lazy loading: cada módulo solo se descarga y se ejecuta cuando el
// usuario realmente entra a esa ruta, en vez de cargar Dashboard + POS +
// Cocina + Inventario + Reportes + Configuración todos de una vez al
// abrir la app.
const Dashboard = lazyWithRetry(() =>
  import("../presentation/pages/Dashboard").then((m) => ({ default: m.Dashboard }))
);
const CashOperationsPage = lazyWithRetry(() =>
  import("../presentation/pages/CashOperationsPage").then((m) => ({ default: m.CashOperationsPage }))
);
const KitchenPage = lazyWithRetry(() =>
  import("../presentation/pages/KitchenPage").then((m) => ({ default: m.KitchenPage }))
);
const InventoryPage = lazyWithRetry(() =>
  import("../presentation/pages/InventoryPage").then((m) => ({ default: m.InventoryPage }))
);
const ReportsPage = lazyWithRetry(() =>
  import("../presentation/pages/ReportsPage").then((m) => ({ default: m.ReportsPage }))
);
const ProfitCenterPage = lazyWithRetry(() =>
  import("../presentation/pages/ProfitCenterPage").then((m) => ({ default: m.ProfitCenterPage }))
);
const LossCenterPage = lazyWithRetry(() =>
  import("../presentation/pages/LossCenterPage").then((m) => ({ default: m.LossCenterPage }))
);
const SmartPurchasingPage = lazyWithRetry(() =>
  import("../presentation/pages/SmartPurchasingPage").then((m) => ({ default: m.SmartPurchasingPage }))
);
const ForecastPage = lazyWithRetry(() =>
  import("../presentation/pages/ForecastPage").then((m) => ({ default: m.ForecastPage }))
);
const SettingsPage = lazyWithRetry(() =>
  import("../presentation/pages/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);
const Meseros = lazyWithRetry(() =>
  import("../presentation/pages/Meseros").then((m) => ({ default: m.Meseros }))
);
const CustomersPage = lazyWithRetry(() =>
  import("../presentation/pages/CustomersPage").then((m) => ({ default: m.CustomersPage }))
);
const NotificationsPage = lazyWithRetry(() =>
  import("../presentation/pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage }))
);
const CopilotPage = lazyWithRetry(() =>
  import("../presentation/pages/CopilotPage").then((m) => ({ default: m.CopilotPage }))
);
const LandingPage = lazyWithRetry(() =>
  import("../marketing/pages/LandingPage").then((m) => ({ default: m.LandingPage }))
);
const PricingPage = lazyWithRetry(() =>
  import("../marketing/pages/PricingPage").then((m) => ({ default: m.PricingPage }))
);
const DemoFondoPage = lazyWithRetry(() =>
  import("../marketing/pages/DemoFondoPage").then((m) => ({ default: m.DemoFondoPage }))
);
const PosCheckoutPage = lazyWithRetry(() =>
  import("../presentation/pages/PosCheckoutPage").then((m) => ({ default: m.PosCheckoutPage }))
);
const FeaturesPage = lazyWithRetry(() =>
  import("../marketing/pages/FeaturesPage").then((m) => ({ default: m.FeaturesPage }))
);
const ContactPage = lazyWithRetry(() =>
  import("../marketing/pages/ContactPage").then((m) => ({ default: m.ContactPage }))
);
const PrivacyPage = lazyWithRetry(() =>
  import("../marketing/pages/PrivacyPage").then((m) => ({ default: m.PrivacyPage }))
);
const TermsPage = lazyWithRetry(() =>
  import("../marketing/pages/TermsPage").then((m) => ({ default: m.TermsPage }))
);
const CookiesPage = lazyWithRetry(() =>
  import("../marketing/pages/CookiesPage").then((m) => ({ default: m.CookiesPage }))
);
const MarketingLayout = lazyWithRetry(() =>
  import("../marketing/components/MarketingLayout").then((m) => ({ default: m.MarketingLayout }))
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
                element={<RoleHomeRedirect />}
              />

              <Route
                path="/dashboard"
                element={
                  <DashboardGate>
                    <Dashboard />
                  </DashboardGate>
                }
              />

              <Route
                path="/caja"
                element={
                  <ProtectedRoute requires={ROUTE_PERMISSIONS["/caja"]}>
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
                  <ProtectedRoute requires={ROUTE_PERMISSIONS["/meseros"]}>
                    <RequireModule module="mesas" alsoCapability="waiters">
                      <Meseros />
                    </RequireModule>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/inventario"
                element={
                  <ProtectedRoute requires={ROUTE_PERMISSIONS["/inventario"]}>
                    <RequireModule module="inventario">
                      <InventoryPage />
                    </RequireModule>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/clientes"
                element={
                  <ProtectedRoute requires={ROUTE_PERMISSIONS["/clientes"]}>
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
                  <ProtectedRoute requires={ROUTE_PERMISSIONS["/reportes"]}>
                    <ReportsPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/ganancias"
                element={
                  <ProtectedRoute requires={ROUTE_PERMISSIONS["/ganancias"]}>
                    <ProfitCenterPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/perdidas"
                element={
                  <ProtectedRoute requires={ROUTE_PERMISSIONS["/perdidas"]}>
                    <LossCenterPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/compras-inteligentes"
                element={
                  <ProtectedRoute requires={ROUTE_PERMISSIONS["/compras-inteligentes"]}>
                    <SmartPurchasingPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/pronostico"
                element={
                  <ProtectedRoute requires={ROUTE_PERMISSIONS["/pronostico"]}>
                    <ForecastPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/configuracion"
                element={
                  <ProtectedRoute requires={ROUTE_PERMISSIONS["/configuracion"]}>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/ia"
                element={
                  <ProtectedRoute requires={ROUTE_PERMISSIONS["/ia"]}>
                    <RequireModule module="ia">
                      <CopilotPage />
                    </RequireModule>
                  </ProtectedRoute>
                }
              />

               <Route
                 path="/pos/checkout/:sessionId"
                 element={<PosCheckoutPage />}
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
      <Suspense fallback={<RouteFallback />}>
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
      </Suspense>
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
      <Route
        element={
          <Suspense fallback={<RouteFallback />}>
            <MarketingLayout />
          </Suspense>
        }
      >
        <Route path="/" element={<LandingPage />} />
        <Route path="/precios" element={<PricingPage />} />
        <Route path="/funciones" element={<FeaturesPage />} />
        <Route path="/contacto" element={<ContactPage />} />
        <Route path="/privacidad" element={<PrivacyPage />} />
        <Route path="/terminos" element={<TermsPage />} />
        <Route path="/cookies" element={<CookiesPage />} />
        <Route path="/demo-fondo" element={<DemoFondoPage />} />
      </Route>

      {/* Cualquier otra ruta desconocida en vimdy.co (por ejemplo, un
          deep link viejo hacia una pantalla de la app) también rebota a
          app.vimdy.co en vez de mostrar la app ahí mismo. */}
      <Route path="/*" element={<RedirectToApp />} />
    </Routes>
  );
}