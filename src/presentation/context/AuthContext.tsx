import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";

import {
  supabase,
  setCurrentBusinessId,
  setCurrentBranchId
} from "../../infrastructure/supabase/supabaseClient";
import { startRealtimeSync, stopRealtimeSync } from "../../infrastructure/supabase/realtimeSync";
import {
  startOfflineSalesSync,
  stopOfflineSalesSync
} from "../../core/offline/syncPendingSales";
import {
  startOfflineInventorySync,
  stopOfflineInventorySync
} from "../../core/offline/syncPendingInventoryAdjustments";
import {
  startOfflineTableSync,
  stopOfflineTableSync
} from "../../core/offline/syncPendingTableOperations";
import {
  startOfflineCustomerSync,
  stopOfflineCustomerSync
} from "../../core/offline/syncPendingCustomerOperations";
import {
  startOfflineKitchenSync,
  stopOfflineKitchenSync
} from "../../core/offline/syncPendingKitchenOrders";
import { pendingSalesStore } from "../../core/offline/pendingSalesStore";
import { pendingCustomerOperationsStore } from "../../core/offline/pendingCustomerOperationsStore";
import { pendingTableOperationsStore } from "../../core/offline/pendingTableOperationsStore";
import { pendingInventoryAdjustmentsStore } from "../../core/offline/pendingInventoryAdjustmentsStore";
import { pendingKitchenOrdersStore } from "../../core/offline/pendingKitchenOrdersStore";
import {
  signIn,
  beginRegistration,
  completeRegistration,
  getUserBusinessesWithRetry,
  getPendingRegistration,
  clearPendingRegistration,
  markOnboardingCompleted,
  requestPasswordReset,
  updatePassword,
  resolveDefaultBranchId,
  requestLoginOtp,
  verifyLoginOtp,
  resendLoginOtp,
  getLoginOtpCooldownSeconds,
  signInWithGoogle,
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
import { businessOperatingProfileStore } from "../../core/store/businessOperatingProfileStore";
import { operationConfigStore } from "../../core/store/operationConfigStore";
import { userSessionStore } from "../../core/store/userSessionStore";
import { hydrateBusinessOperatingProfile } from "../../core/bootstrap/businessOperatingProfileBootstrap";
import {
  CountryCode,
  CurrencyCode,
  LanguageCode
} from "../../core/config/globalization";
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
  businessCount: number;
  isAuthenticated: boolean;
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
  businessBootstrapError: string | null;
  onboardingCompleted: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterBusinessInput) => Promise<void>;
  verifyOtp: (code: string) => Promise<void>;
  resendOtp: () => Promise<void>;
  resendCooldownSeconds: () => number;
  pendingRegistrationEmail: () => string | null;
  cancelRegistration: () => void;
  logout: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  requestLoginOtp: (email: string) => Promise<void>;
  verifyLoginOtp: (email: string, token: string) => Promise<void>;
  resendLoginOtp: (email: string) => Promise<void>;
  loginOtpCooldownSeconds: (email?: string) => number;
  signInWithGoogle: () => Promise<void>;
  can: (permissionId: string) => boolean;
  completeOnboarding: () => Promise<void>;
  switchBusiness: (businessSession: BusinessSession) => Promise<void>;
  retryBusinessBootstrap: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function authUserFromSupabase(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): AuthUser {
  const email = user.email ?? "";
  const metadata = user.user_metadata ?? {};
  const name =
    typeof metadata.full_name === "string" && metadata.full_name.trim()
      ? metadata.full_name.trim()
      : email.split("@")[0] || "Usuario";

  const avatar =
    typeof metadata.avatar_url === "string" && metadata.avatar_url.trim()
      ? metadata.avatar_url
      : undefined;

  return {
    id: user.id,
    name,
    email,
    avatar
  };
}

function toAuthState(
  session: BusinessSession,
  email: string
): { user: AuthUser; role: AuthRole } {
  return {
    user: {
      id: session.userId,
      name: session.ownerName || email.split("@")[0],
      email
    },
    role: {
      id: session.role,
      name: session.role,
      permissions: permissionsForRole(session.role)
    }
  };
}

function hydrateBusinessConfig(session: BusinessSession): void {
  businessStore.update({
    name: session.businessName,
    owner: session.ownerName,
    country: session.country as CountryCode
  });

  companyConfigStore.update({
    country: session.country as CountryCode,
    currency: session.currency as CurrencyCode,
    language: session.language as LanguageCode,
    timezone: session.timezone,
    tax: session.taxRate
  });

  enabledModulesStore.set(session.enabledModules as ModuleId[]);
}

async function hydrateSubscription(businessId: string): Promise<void> {
  try {
    const subscription = await fetchSubscription(businessId);
    if (subscription) {
      subscriptionStore.hydrate(subscription);
      const { evaluateSubscriptionNotifications } = await import(
        "../../core/store/subscriptionNotifications"
      );
      evaluateSubscriptionNotifications();
    }
  } catch {
    // No bloqueamos el acceso por un fallo secundario del estado de suscripción.
  }
}

function stopLocalBusinessSyncs(): void {
  stopRealtimeSync();
  stopOfflineSalesSync();
  stopOfflineInventorySync();
  stopOfflineTableSync();
  stopOfflineCustomerSync();
  stopOfflineKitchenSync();

  void pendingSalesStore.clear();
  void pendingCustomerOperationsStore.clear();
  void pendingTableOperationsStore.clear();
  void pendingInventoryAdjustmentsStore.clear();
  void pendingKitchenOrdersStore.clear();

  setCurrentBusinessId(null);
  setCurrentBranchId(null);
  enabledModulesStore.clear();
  subscriptionStore.clear();
  kitchenOutputModeStore.clear();
  businessOperatingProfileStore.clear();
  operationConfigStore.clear();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [role, setRole] = useState<AuthRole | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessCount, setBusinessCount] = useState(0);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businessBootstrapError, setBusinessBootstrapError] = useState<string | null>(null);

  const navigate = useNavigate();
  const bootstrapGeneration = useRef(0);
  const authOperationInFlight = useRef(0);
  const authCleanupInProgress = useRef(false);

  const clearAuthState = useCallback(() => {
    if (authCleanupInProgress.current) return;
    authCleanupInProgress.current = true;

    try {
      stopLocalBusinessSyncs();
      setUser(null);
      setRole(null);
      setSessionId(null);
      setBusinessId(null);
      setBusinessCount(0);
      setOnboardingCompleted(false);
      setBusinessBootstrapError(null);
      userSessionStore.logout();
    } finally {
      authCleanupInProgress.current = false;
    }
  }, []);

  const applyBusinessSession = useCallback(
    async (businessSession: BusinessSession, email: string) => {
      const { user: authUserState, role: authRole } = toAuthState(
        businessSession,
        email
      );

      stopLocalBusinessSyncs();

      const branchId = await resolveDefaultBranchId(businessSession.businessId);
      setCurrentBranchId(branchId);

      try {
        void hydrateBusinessOperatingProfile(businessSession.businessId);
        hydrateBusinessConfig(businessSession);
        void hydrateSubscription(businessSession.businessId);
        void ensureIdentity(
          container.permissionEngine.get(),
          container.roleEngine.get()
        );

        startRealtimeSync(businessSession.businessId);
        startOfflineSalesSync();
        startOfflineInventorySync();
        startOfflineTableSync();
        startOfflineCustomerSync();
        startOfflineKitchenSync();
      } catch (syncError) {
        setCurrentBusinessId(null);
        setCurrentBranchId(null);
        throw syncError;
      }

      setCurrentBusinessId(businessSession.businessId);

      setUser(authUserState);
      setRole(authRole);
      setSessionId(businessSession.userId);
      setBusinessId(businessSession.businessId);
      setBusinessCount(1);
      setOnboardingCompleted(businessSession.onboardingCompleted);
      setBusinessBootstrapError(null);

      userSessionStore.login(
        businessSession.userId,
        authUserState.name,
        authRole.name,
        authUserState.email
      );
    },
    []
  );

  const hydrateAuthSession = useCallback(
    async (session: Session | null, navigateOnCompletion = false): Promise<void> => {
      const generation = ++bootstrapGeneration.current;

      if (!session?.user) {
        clearAuthState();
        setIsReady(true);
        return;
      }

      const authUser = session.user;
      const email = authUser.email ?? "";
      setUser(authUserFromSupabase(authUser));
      setSessionId(authUser.id);
      setRole(null);
      setBusinessId(null);
      setBusinessCount(0);
      setOnboardingCompleted(false);
      setBusinessBootstrapError(null);
      setIsReady(false);

      let businesses: BusinessSession[];

      try {
        businesses = await getUserBusinessesWithRetry(
          authUser.id,
          typeof authUser.user_metadata?.full_name === "string"
            ? authUser.user_metadata.full_name
            : ""
        );
      } catch (bootstrapError) {
        if (generation !== bootstrapGeneration.current) return;

        console.error("[AuthContext] No se pudo resolver el negocio:", bootstrapError);
        setBusinessBootstrapError(
          "Tu sesión está activa, pero no pudimos cargar el negocio. Revisa tu conexión y vuelve a intentarlo."
        );
        setIsReady(true);
        return;
      }

      if (generation !== bootstrapGeneration.current) return;

      if (businesses.length === 0) {
        stopLocalBusinessSyncs();
        setUser(authUserFromSupabase(authUser));
        setSessionId(authUser.id);
        setRole(null);
        setBusinessId(null);
        setBusinessCount(0);
        setOnboardingCompleted(false);
        setBusinessBootstrapError(null);
        setIsReady(true);

        if (navigateOnCompletion) {
          navigate("/crear-negocio", { replace: true });
        }
        return;
      }

      if (businesses.length === 1) {
        try {
          await applyBusinessSession(businesses[0], email);
        } catch (applyError) {
          if (generation !== bootstrapGeneration.current) return;

          console.error("[AuthContext] Fallo cargando el negocio:", applyError);
          setBusinessBootstrapError(
            "Tu sesión está activa, pero no pudimos preparar el negocio. Vuelve a intentarlo."
          );
          setIsReady(true);
          return;
        }

        if (generation !== bootstrapGeneration.current) return;

        setIsReady(true);

        if (
          navigateOnCompletion &&
          window.location.pathname !== "/auth/callback" &&
          window.location.pathname !== "/actualizar-password"
        ) {
          navigate("/dashboard", { replace: true });
        }
        return;
      }

      stopLocalBusinessSyncs();
      setUser(authUserFromSupabase(authUser));
      setRole(null);
      setSessionId(authUser.id);
      setBusinessId(null);
      setBusinessCount(businesses.length);
      setOnboardingCompleted(false);
      setBusinessBootstrapError(null);
      setIsReady(true);

      if (navigateOnCompletion) {
        navigate("/business-selector", {
          replace: true,
          state: { businesses }
        });
      }
    },
    [applyBusinessSession, clearAuthState, navigate]
  );

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (cancelled) return;

      if (sessionError) {
        console.error("[AuthContext] Fallo al restaurar la sesión:", sessionError);
        setBusinessBootstrapError(
          "No pudimos comprobar tu sesión. Revisa tu conexión y vuelve a intentarlo."
        );
        setIsReady(true);
        return;
      }

      void hydrateAuthSession(data.session, false);
    });

    const { data: authSubscription } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_OUT" || !session) {
          clearAuthState();
          setIsReady(true);
          return;
        }

        // Supabase recomienda no ejecutar llamadas async adicionales dentro
        // de este callback. Diferimos el bootstrap al siguiente tick para
        // evitar carreras/deadlocks durante refresh o OAuth.
        if (event === "INITIAL_SESSION") {
          void hydrateAuthSession(session, false);
          return;
        }

        if (
          (event === "SIGNED_IN" || event === "USER_UPDATED") &&
          authOperationInFlight.current === 0
        ) {
          window.setTimeout(() => {
            void hydrateAuthSession(session, false);
          }, 0);
        }
      }
    );

    return () => {
      cancelled = true;
      authSubscription.subscription.unsubscribe();
      bootstrapGeneration.current += 1;
      stopRealtimeSync();
    };
  }, [clearAuthState, hydrateAuthSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedEmail || !password) {
        throw new Error("Ingresa tu correo y tu contraseña.");
      }

      setIsLoading(true);
      setError(null);
      setBusinessBootstrapError(null);
      authOperationInFlight.current += 1;

      try {
        const result = await signIn(normalizedEmail, password);

        if (result === null) {
          const { data: authUserData, error: authUserError } =
            await supabase.auth.getUser();

          if (authUserError || !authUserData.user) {
            throw new Error(
              "La cuenta existe, pero no tiene un negocio asociado. Intenta crear uno nuevamente."
            );
          }

          await hydrateAuthSession(
            (await supabase.auth.getSession()).data.session,
            true
          );
          return;
        }

        if (Array.isArray(result)) {
          setBusinessCount(result.length);
          setUser({
            id: result[0]?.userId ?? "",
            name: result[0]?.ownerName ?? normalizedEmail.split("@")[0],
            email: normalizedEmail
          });
          setSessionId(result[0]?.userId ?? null);
          setRole(null);
          setBusinessId(null);
          setOnboardingCompleted(false);
          setIsReady(true);
          navigate("/business-selector", {
            replace: true,
            state: { businesses: result }
          });
          return;
        }

        await applyBusinessSession(result, normalizedEmail);
        setIsReady(true);
        navigate("/dashboard", { replace: true });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "No se pudo iniciar sesión. Inténtalo de nuevo.";
        setError(message);
        throw err;
      } finally {
        authOperationInFlight.current = Math.max(0, authOperationInFlight.current - 1);
        setIsLoading(false);
      }
    },
    [applyBusinessSession, hydrateAuthSession, navigate]
  );

  const register = useCallback(async (input: RegisterBusinessInput) => {
    setIsLoading(true);
    setError(null);
    authOperationInFlight.current += 1;

    try {
      await beginRegistration({
        ...input,
        email: input.email.trim().toLowerCase(),
        businessName: input.businessName.trim(),
        ownerName: input.ownerName.trim()
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "No se pudo iniciar el registro.";
      setError(message);
      throw err;
    } finally {
      authOperationInFlight.current = Math.max(0, authOperationInFlight.current - 1);
      setIsLoading(false);
    }
  }, []);

  const verifyOtp = useCallback(
    async (code: string) => {
      setIsLoading(true);
      setError(null);
      authOperationInFlight.current += 1;

      try {
        await verifyRegistrationOtp(code);

        const pendingEmail = getPendingRegistration()?.email;

        const businessSession = await completeRegistration();
        await applyBusinessSession(
          businessSession,
          pendingEmail ?? businessSession.ownerName
        );

        setIsReady(true);
        navigate("/onboarding", { replace: true });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "No se pudo verificar el código.";
        setError(message);
        throw err;
      } finally {
        authOperationInFlight.current = Math.max(0, authOperationInFlight.current - 1);
        setIsLoading(false);
      }
    },
    [applyBusinessSession, navigate]
  );

  const resendOtp = useCallback(async () => {
    setError(null);
    try {
      await resendRegistrationOtp();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "No se pudo reenviar el código.";
      setError(message);
      throw err;
    }
  }, []);

  const resendCooldownSeconds = useCallback(
    () => getResendCooldownSeconds(),
    []
  );

  const pendingRegistrationEmail = useCallback(
    () => getPendingRegistration()?.email ?? null,
    []
  );

  const cancelRegistration = useCallback(() => {
    clearPendingRegistration();
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      const { error: signOutError } = await supabase.auth.signOut({
        scope: "local"
      });

      if (signOutError) {
        console.warn("[AuthContext] signOut local falló:", signOutError.message);
        throw signOutError;
      }
    } catch (err) {
      console.warn("[AuthContext] signOut lanzó una excepción:", err);
      throw err;
    }
  }, []);

  const handleRequestPasswordReset = useCallback(
    async (email: string) => {
      setIsLoading(true);
      setError(null);

      try {
        await requestPasswordReset(email.trim().toLowerCase());
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "No se pudo enviar el correo de recuperación.";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handleUpdatePassword = useCallback(
    async (newPassword: string) => {
      setIsLoading(true);
      setError(null);
      authOperationInFlight.current += 1;

      try {
        await updatePassword(newPassword);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "No se pudo actualizar la contraseña.";
        setError(message);
        throw err;
      } finally {
        authOperationInFlight.current = Math.max(0, authOperationInFlight.current - 1);
        setIsLoading(false);
      }
    },
    []
  );

  const completeOnboarding = useCallback(async () => {
    if (!businessId) {
      throw new Error("No hay un negocio activo en la sesión.");
    }

    await markOnboardingCompleted(businessId);
    setOnboardingCompleted(true);
  }, [businessId]);

  const handleRequestLoginOtp = useCallback(async (email: string) => {
    setIsLoading(true);
    setError(null);

    try {
      await requestLoginOtp(email.trim().toLowerCase());
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "No se pudo enviar el código.";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleVerifyLoginOtp = useCallback(
    async (email: string, token: string) => {
      setIsLoading(true);
      setError(null);
      authOperationInFlight.current += 1;

      try {
        const normalizedEmail = email.trim().toLowerCase();
        const result = await verifyLoginOtp(normalizedEmail, token);

        if (result === null) {
          await hydrateAuthSession(
            (await supabase.auth.getSession()).data.session,
            true
          );
          return;
        }

        if (Array.isArray(result)) {
          setBusinessCount(result.length);
          setUser({
            id: result[0]?.userId ?? "",
            name: result[0]?.ownerName ?? normalizedEmail.split("@")[0],
            email: normalizedEmail
          });
          setSessionId(result[0]?.userId ?? null);
          setBusinessId(null);
          setRole(null);
          setOnboardingCompleted(false);
          navigate("/business-selector", {
            replace: true,
            state: { businesses: result }
          });
          return;
        }

        await applyBusinessSession(result, normalizedEmail);
        setIsReady(true);
        navigate("/dashboard", { replace: true });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "No se pudo iniciar sesión con el código.";
        setError(message);
        throw err;
      } finally {
        authOperationInFlight.current = Math.max(0, authOperationInFlight.current - 1);
        setIsLoading(false);
      }
    },
    [applyBusinessSession, hydrateAuthSession, navigate]
  );

  const handleResendLoginOtp = useCallback(async (email: string) => {
    setError(null);

    try {
      await resendLoginOtp(email.trim().toLowerCase());
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "No se pudo reenviar el código.";
      setError(message);
      throw err;
    }
  }, []);

  const loginOtpCooldownSeconds = useCallback(
    (email?: string) => getLoginOtpCooldownSeconds(email),
    []
  );

  const handleSignInWithGoogle = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      await signInWithGoogle();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "No se pudo iniciar sesión con Google.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const switchBusiness = useCallback(
    async (businessSession: BusinessSession) => {
      setIsLoading(true);
      setError(null);

      try {
        await applyBusinessSession(
          businessSession,
          user?.email ?? businessSession.ownerName
        );
        setIsReady(true);
        navigate("/dashboard", { replace: true });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "No se pudo abrir el negocio seleccionado.";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [applyBusinessSession, navigate, user?.email]
  );

  const retryBusinessBootstrap = useCallback(async () => {
    setError(null);
    setBusinessBootstrapError(null);
    setIsReady(false);

    const { data, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !data.session) {
      setIsReady(true);
      setBusinessBootstrapError(
        "No pudimos recuperar tu sesión. Inicia sesión nuevamente si el problema continúa."
      );
      return;
    }

    await hydrateAuthSession(data.session, false);
  }, [hydrateAuthSession]);

  const can = useCallback(
    (permissionId: string) => {
      if (!role) return false;
      return (
        role.permissions.includes("*") ||
        role.permissions.includes(permissionId)
      );
    },
    [role]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      role,
      sessionId,
      businessId,
      businessCount,
      isAuthenticated: !!user && !!sessionId,
      isReady,
      isLoading,
      error,
      businessBootstrapError,
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
      requestLoginOtp: handleRequestLoginOtp,
      verifyLoginOtp: handleVerifyLoginOtp,
      resendLoginOtp: handleResendLoginOtp,
      loginOtpCooldownSeconds,
      signInWithGoogle: handleSignInWithGoogle,
      can,
      completeOnboarding,
      switchBusiness,
      retryBusinessBootstrap
    }),
    [
      user,
      role,
      sessionId,
      businessId,
      businessCount,
      isReady,
      isLoading,
      error,
      businessBootstrapError,
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
      handleRequestLoginOtp,
      handleVerifyLoginOtp,
      handleResendLoginOtp,
      loginOtpCooldownSeconds,
      handleSignInWithGoogle,
      can,
      completeOnboarding,
      switchBusiness,
      retryBusinessBootstrap
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
