import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";

import { useNavigate } from "react-router-dom";

import { supabase, setCurrentBusinessId, setCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { startRealtimeSync, stopRealtimeSync } from "../../infrastructure/supabase/realtimeSync";
import { startOfflineSalesSync, stopOfflineSalesSync } from "../../core/offline/syncPendingSales";
import { startOfflineInventorySync, stopOfflineInventorySync } from "../../core/offline/syncPendingInventoryAdjustments";
import { startOfflineTableSync, stopOfflineTableSync } from "../../core/offline/syncPendingTableOperations";
import { startOfflineCustomerSync, stopOfflineCustomerSync } from "../../core/offline/syncPendingCustomerOperations";
import { pendingSalesStore } from "../../core/offline/pendingSalesStore";
import { pendingCustomerOperationsStore } from "../../core/offline/pendingCustomerOperationsStore";
import { pendingTableOperationsStore } from "../../core/offline/pendingTableOperationsStore";
import { pendingInventoryAdjustmentsStore } from "../../core/offline/pendingInventoryAdjustmentsStore";
import {
  signIn,
  signOut,
  beginRegistration,
  completeRegistration,
  resolveBusinessSession,
  getUserBusinesses,
  getPendingRegistration,
  clearPendingRegistration,
  markOnboardingCompleted,
  requestPasswordReset,
  updatePassword,
  resolveDefaultBranchId,
  type BusinessSession,
  type RegisterBusinessInput
} from "../../infrastructure/supabase/authBusinessContext";
import { ensureIdentity } from "../../infrastructure/di/seedIdentity";
import { container } from "../../infrastructure/di/CompositionRoot";
import {
  verifyRegistrationOtp,
  resendRegistrationOtp,
  getResendCooldownSeconds
} from "../../infrastructure/supabase/authOtp";
import { permissionsForRole } from "../../infrastructure/supabase/rolePermissions";
import { fetchSubscription } from "../../infrastructure/supabase/subscriptionContext";
import { businessStore } from "../../core/store/businessStore";
import { companyConfigStore } from "../../core/store/companyConfigStore";
import { enabledModulesStore } from "../../core/store/enabledModulesStore";
import { kitchenOutputModeStore } from "../../core/store/kitchenOutputModeStore";
import { subscriptionStore } from "../../core/store/subscriptionStore";
import { CountryCode, CurrencyCode, LanguageCode } from "../../core/config/globalization";
import type { ModuleId } from "../../core/config/modules";

interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

interface AuthRole {
  id: string;
  name: string;
  permissions: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  role: AuthRole | null;
  sessionId: string | null;
  businessId: string | null;
  isAuthenticated: boolean;
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
  /** Fase 3 — Onboarding inteligente: false hasta terminar el asistente de /onboarding. */
  onboardingCompleted: boolean;
  login: (email: string, password: string) => Promise<void>;
  /**
   * Registro de negocio — PASO 1: crea el usuario en Supabase Auth (sin
   * confirmar) y dispara el correo con el código OTP de 6 dígitos. NO deja
   * sesión activa todavía — para eso está verifyOtp().
   */
  register: (input: RegisterBusinessInput) => Promise<void>;
  /**
   * Registro de negocio — PASO 2: verifica el código OTP de 6 dígitos y,
   * si es correcto, crea el negocio + membresía ADMIN + trial de 30 días
   * (Edge Function register-business) y deja la sesión activa.
   */
  verifyOtp: (code: string) => Promise<void>;
  /** Reenvía el código OTP al correo del registro en curso (cooldown de 30s en cliente). */
  resendOtp: () => Promise<void>;
  /** Segundos restantes antes de poder reenviar el código; 0 si ya se puede. */
  resendCooldownSeconds: () => number;
  /** Correo al que se envió el código, para mostrarlo en la pantalla de OTP. Null si no hay registro en curso. */
  pendingRegistrationEmail: () => string | null;
  /** Cancela un registro en curso (botón "volver" en la pantalla de OTP). */
  cancelRegistration: () => void;
  logout: () => Promise<void>;
  /** Recuperación de contraseña — paso 1: envía el correo. No lanza si el correo no existe (Supabase no lo revela). */
  requestPasswordReset: (email: string) => Promise<void>;
  /** Recuperación de contraseña — paso 2: fija la nueva, usando la sesión temporal del link del correo. */
  updatePassword: (newPassword: string) => Promise<void>;
  /** Verificación de permiso en el cliente, contra el rol ya cargado en sesión. */
  can: (permissionId: string) => boolean;
  /** Marca el onboarding como terminado, real en Supabase (PASO 11 del asistente). */
  completeOnboarding: () => Promise<void>;
  switchBusiness: (businessSession: BusinessSession) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Convierte lo que devuelve signIn()/completeRegistration()/la sesión
 * restaurada de Supabase en el shape que ya consumía toda la UI
 * (AuthUser + AuthRole), para no tener que tocar ProtectedRoute,
 * UserSessionBadge, SettingsDashboard, etc.
 */
function toAuthState(session: BusinessSession, email: string): { user: AuthUser; role: AuthRole } {
  return {
    user: { id: session.userId, name: session.ownerName || email.split("@")[0], email },
    role: {
      id: session.role,
      name: session.role,
      permissions: permissionsForRole(session.role)
    }
  };
}

/**
 * Vuelca en businessStore/companyConfigStore (el estado local que lee toda
 * la UI: Settings, formateo de precios, fechas, etc) la configuración
 * inteligente por país que ya quedó calculada y guardada en `businesses`
 * al registrar el negocio. Se llama al hacer login, al registrarse y al
 * restaurar una sesión guardada — así el usuario "ya encuentra todo listo"
 * (moneda, idioma, zona horaria e impuesto correctos) sin tocar nada.
 */
function hydrateBusinessConfig(session: BusinessSession) {
  businessStore.update({
    name: session.businessName,
    owner: session.ownerName,
    country: session.country
  });
  companyConfigStore.update({
    country: session.country as CountryCode,
    currency: session.currency as CurrencyCode,
    language: session.language as LanguageCode,
    timezone: session.timezone,
    tax: session.taxRate
  });
  // PASO 4 del onboarding: el Sidebar (VimdySidebar.tsx) lee este store
  // para mostrar/ocultar Mesas, Cocina, etc. según lo que el negocio
  // guardó realmente en Supabase (enabled_modules).
  enabledModulesStore.set(session.enabledModules as ModuleId[]);
  // Punto 5.5/5.7: OrderEngine/TableEngine/SalesEngine leen esto en vivo
  // al enviar una comanda, para decidir entre KitchenScreenOutput y
  // KitchenPrinterOutput (ver KitchenOutputFactory.ts).
  kitchenOutputModeStore.set(session.salidaCocina);
}

/**
 * VIMDY — FASE 7: carga en subscriptionStore el estado real del plan del
 * negocio (trial/monthly/yearly, días restantes, método de pago...) desde
 * Supabase. Se llama en los mismos 3 momentos que hydrateBusinessConfig
 * (restaurar sesión, login, registro) para que el contador de PASO 3 y el
 * gate de cobro de PASO 5/9 tengan datos reales desde el primer render.
 * Si falla (sin red, etc.) no rompe el login — simplemente no bloquea ni
 * muestra avisos hasta que se pueda leer de nuevo.
 */
async function hydrateSubscription(businessId: string): Promise<void> {
  try {
    const subscription = await fetchSubscription(businessId);
    if (subscription) subscriptionStore.hydrate(subscription);
  } catch {
    // Sin conexión momentánea: no bloqueamos el login por esto.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [role, setRole] = useState<AuthRole | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Al montar: si Supabase Auth ya tiene una sesión guardada (localStorage,
  // la maneja el propio SDK), la restauramos y resolvemos el business_id
  // automáticamente, sin pedirle credenciales de nuevo al usuario.
  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      const authUser = data.session?.user;

      if (!authUser) {
        if (!cancelled) setIsReady(true);
        return;
      }

      const ownerName = (authUser.user_metadata?.full_name as string | undefined) ?? "";
      const businesses = await getUserBusinesses(authUser.id);

      if (cancelled) return;

      if (businesses.length === 0) {
        if (!cancelled) setIsReady(true);
        return;
      }

      if (businesses.length === 1) {
        const session = businesses[0];
        setCurrentBusinessId(session.businessId);

        try {
          const [resolvedBranchId] = await Promise.all([
            resolveDefaultBranchId(session.businessId),
            hydrateBusinessConfig(session),
            hydrateSubscription(session.businessId),
            ensureIdentity(container.permissionEngine, container.roleEngine)
          ]);
          setCurrentBranchId(resolvedBranchId);
          startRealtimeSync(session.businessId);
          startOfflineSalesSync();
          startOfflineInventorySync();
          startOfflineTableSync();
          startOfflineCustomerSync();
        } catch (error) {
          console.error("[AuthContext] Fallo en bootstrap de sesión:", error);
        }

        const { user: u, role: r } = toAuthState(session, authUser.email ?? "");
        setUser(u);
        setRole(r);
        setSessionId(authUser.id);
        setBusinessId(session.businessId);
        setOnboardingCompleted(session.onboardingCompleted);

        if (!cancelled) setIsReady(true);
      } else {
        if (!cancelled) setIsReady(true);
      }
    }).catch((error) => {
      console.error("[AuthContext] Fallo al restaurar sesión:", error);
      if (!cancelled) setIsReady(true);
    });

    // Mantiene la sesión sincronizada si Supabase la cierra por su cuenta
    // (token expirado, logout desde otra pestaña, etc).
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!newSession) {
        stopRealtimeSync();
        stopOfflineSalesSync();
        stopOfflineInventorySync();
        stopOfflineTableSync();
        stopOfflineCustomerSync();
        void pendingSalesStore.clear();
        void pendingCustomerOperationsStore.clear();
        void pendingTableOperationsStore.clear();
        void pendingInventoryAdjustmentsStore.clear();
        setCurrentBusinessId(null);
        setCurrentBranchId(null);
        setUser(null);
        setRole(null);
        setSessionId(null);
      }
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await signIn(email, password);

      if (result === null) {
        navigate("/onboarding", { replace: true });
        return;
      }

      if (Array.isArray(result)) {
        navigate("/business-selector", { replace: true, state: { businesses: result } });
        return;
      }

      const businessSession = result;
      setCurrentBusinessId(businessSession.businessId);
      hydrateBusinessConfig(businessSession);
      hydrateSubscription(businessSession.businessId);
      void ensureIdentity(container.permissionEngine, container.roleEngine);
      const { user: u, role: r } = toAuthState(businessSession, email);

      startRealtimeSync(businessSession.businessId);
      startOfflineSalesSync();
      startOfflineInventorySync();
      startOfflineTableSync();
      startOfflineCustomerSync();
      setUser(u);
      setRole(r);
      setSessionId(businessSession.userId);
      setBusinessId(businessSession.businessId);
      setOnboardingCompleted(businessSession.onboardingCompleted);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo iniciar sesión.";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [navigate]);

  const switchBusiness = useCallback(async (businessSession: BusinessSession) => {
    setCurrentBusinessId(businessSession.businessId);
    const resolvedBranchId = await resolveDefaultBranchId(businessSession.businessId);
    setCurrentBranchId(resolvedBranchId);
    hydrateBusinessConfig(businessSession);
    hydrateSubscription(businessSession.businessId);
    void ensureIdentity(container.permissionEngine, container.roleEngine);
    setUser({ id: businessSession.userId, name: businessSession.ownerName, email: user?.email ?? "" });
    setRole({ id: businessSession.role, name: businessSession.role, permissions: permissionsForRole(businessSession.role) });
    setSessionId(businessSession.userId);
    setBusinessId(businessSession.businessId);
    setOnboardingCompleted(businessSession.onboardingCompleted);
    navigate("/dashboard", { replace: true });
  }, [navigate, user?.email]);

  const register = useCallback(async (input: RegisterBusinessInput) => {
    setIsLoading(true);
    setError(null);

    try {
      // PASO 1: crea el usuario sin confirmar y dispara el correo con el
      // código OTP. Todavía no hay sesión ni negocio — eso ocurre en
      // verifyOtp(), una vez el usuario escribe el código de 6 dígitos.
      await beginRegistration(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo iniciar el registro.";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const verifyOtp = useCallback(async (code: string) => {
    setIsLoading(true);
    setError(null);

    try {
      // PASO 2a: confirma el código -> deja la sesión activa y confirmada.
      await verifyRegistrationOtp(code);
      // PASO 2b: con la sesión ya confirmada, crea el negocio + membresía
      // ADMIN + trial de 30 días, y resuelve la sesión de negocio completa.
      const businessSession = await completeRegistration();

      hydrateBusinessConfig(businessSession);
      hydrateSubscription(businessSession.businessId);
      void ensureIdentity(container.permissionEngine, container.roleEngine);
      const pending = getPendingRegistration();
      const { user: u, role: r } = toAuthState(businessSession, pending?.email ?? "");

      setCurrentBusinessId(businessSession.businessId);
      startRealtimeSync(businessSession.businessId);
      startOfflineSalesSync();
      startOfflineInventorySync();
      startOfflineTableSync();
      startOfflineCustomerSync();
      setUser(u);
      setRole(r);
      setSessionId(businessSession.userId);
      setBusinessId(businessSession.businessId);
      setOnboardingCompleted(businessSession.onboardingCompleted);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo verificar el código.";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const resendOtp = useCallback(async () => {
    setError(null);
    try {
      await resendRegistrationOtp();
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo reenviar el código.";
      setError(message);
      throw err;
    }
  }, []);

  const resendCooldownSeconds = useCallback(() => getResendCooldownSeconds(), []);

  const pendingRegistrationEmail = useCallback(() => getPendingRegistration()?.email ?? null, []);

  const cancelRegistration = useCallback(() => {
    clearPendingRegistration();
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    await signOut().catch(() => {});
    stopRealtimeSync();
    stopOfflineSalesSync();
    stopOfflineInventorySync();
    stopOfflineTableSync();
    stopOfflineCustomerSync();
    void pendingSalesStore.clear();
    void pendingCustomerOperationsStore.clear();
    void pendingTableOperationsStore.clear();
    void pendingInventoryAdjustmentsStore.clear();
    enabledModulesStore.clear();
    subscriptionStore.clear();
    setUser(null);
    setRole(null);
    setSessionId(null);
  }, []);

  const handleRequestPasswordReset = useCallback(async (email: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await requestPasswordReset(email);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo enviar el correo de recuperación.";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleUpdatePassword = useCallback(async (newPassword: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await updatePassword(newPassword);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo actualizar la contraseña.";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const completeOnboarding = useCallback(async () => {
    if (!businessId) {
      throw new Error("No hay un negocio activo en la sesión.");
    }
    await markOnboardingCompleted(businessId);
    setOnboardingCompleted(true);
  }, [businessId]);

  const can = useCallback(
    (permissionId: string) => {
      if (!role) return false;
      return role.permissions.includes("*") || role.permissions.includes(permissionId);
    },
    [role]
  );

  // Sin useMemo, este objeto se recrea en cada render del AuthProvider
  // (por ejemplo, cuando isLoading cambia durante un login), y como es
  // una referencia nueva, TODO lo que consume useAuth() —incluido
  // ProtectedRoute, que envuelve la app entera— se re-renderiza también,
  // aunque el dato que le importa no haya cambiado.
  const value: AuthContextValue = useMemo(
    () => ({
      user,
      role,
      sessionId,
      businessId,
      isAuthenticated: !!user && !!sessionId,
      isReady,
      isLoading,
      error,
      onboardingCompleted,
      login,
      register,
      verifyOtp,
      resendOtp,
      resendCooldownSeconds,
      pendingRegistrationEmail,
      cancelRegistration,
      logout,
      requestPasswordReset: handleRequestPasswordReset,
      updatePassword: handleUpdatePassword,
      can,
      completeOnboarding,
      switchBusiness
    }),
    [
      user,
      role,
      sessionId,
      businessId,
      isReady,
      isLoading,
      error,
      onboardingCompleted,
      login,
      register,
      verifyOtp,
      resendOtp,
      resendCooldownSeconds,
      pendingRegistrationEmail,
      cancelRegistration,
      logout,
      handleRequestPasswordReset,
      handleUpdatePassword,
      can,
      completeOnboarding,
      switchBusiness
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>.");
  }
  return ctx;
}