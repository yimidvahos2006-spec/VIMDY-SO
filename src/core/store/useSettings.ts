import { useCallback, useEffect, useRef, useState } from "react";
import { container, identityReady } from "../../infrastructure/di/CompositionRoot";
import { businessStore, Business } from "./businessStore";
import { companyConfigStore, CompanyConfig } from "./companyConfigStore";
import { Role, User, UserStatus } from "../entities/Entities";
import { AVAILABLE_COUNTRY_CODES } from "../config/globalization";
import {
  buildBusinessSettingsUpdate,
  saveBusinessSettings,
  writeCachedBusinessSettings
} from "../../infrastructure/supabase/businessSettings";
import { getCurrentBusinessId } from "../../infrastructure/supabase/supabaseClient";
import { translateBusinessError } from "../errors/translateBusinessError";
import { staleWhileRevalidate } from "../utils/staleWhileRevalidate";
import { vimdyCore } from "../VimdyCore";
import { logWarning } from "../../infrastructure/logging/opsLogger";

interface TeamSnapshot {
  users: User[];
  roles: Role[];
}

/**
 * Aplica sobre una lista de usuarios los cambios de estado que el usuario ya
 * hizo en pantalla y el servidor todavía no confirmó, para que una respuesta
 * vieja de la red no los deshaga por un instante (parpadeo).
 */
function withPendingStatuses(users: User[], pending: ReadonlyMap<string, UserStatus>): User[] {
  if (pending.size === 0) return users;
  const result: User[] = [];
  for (const user of users) {
    const status = pending.get(user.id);
    if (status === undefined) {
      result.push(user);
    } else if (status !== "DELETED") {
      result.push({ ...user, status });
    }
  }
  return result;
}

export function useSettings() {
  const [business, setBusiness] = useState<Business>(businessStore.get());
  const [config, setConfig] = useState<CompanyConfig>(companyConfigStore.get());
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Cambios de estado ya mostrados en pantalla que el servidor aún no confirma. */
  const pendingStatuses = useRef(new Map<string, UserStatus>());
  /** Espejo de `users` para poder deshacer un cambio optimista sin depender del render. */
  const usersRef = useRef<User[]>([]);

  const applyTeam = useCallback((snapshot: TeamSnapshot) => {
    const nextUsers = withPendingStatuses(snapshot.users, pendingStatuses.current);
    usersRef.current = nextUsers;
    setUsers(nextUsers);
    setRoles(snapshot.roles);
  }, []);

  /** Lee el equipo y los roles guardados en este dispositivo (sin red). null si falta alguno. */
  const readTeamCache = useCallback(async (): Promise<TeamSnapshot | null> => {
    const [cachedUsers, cachedRoles] = await Promise.all([
      container.userEngine.get().listUsersCached(),
      container.roleEngine.get().listRolesCached()
    ]);
    if (!cachedUsers || !cachedRoles) return null;
    return { users: cachedUsers, roles: cachedRoles };
  }, []);

  /** Pide el equipo y los roles al servidor. `fresh` ignora la memoria de 15 s. */
  const fetchTeam = useCallback(async (fresh: boolean): Promise<TeamSnapshot> => {
    await identityReady;
    const userEngine = container.userEngine.get();
    const roleEngine = container.roleEngine.get();
    const [allUsers, allRoles] = await Promise.all([
      fresh ? userEngine.listUsersFresh() : userEngine.listUsers(),
      fresh ? roleEngine.listRolesFresh() : roleEngine.listRoles()
    ]);
    return { users: allUsers, roles: allRoles };
  }, []);

  /** Refresca por detrás, sin spinner. Un fallo de red no rompe lo que ya se ve. */
  const refreshTeam = useCallback(async (): Promise<void> => {
    try {
      applyTeam(await fetchTeam(true));
    } catch (e) {
      logWarning("[useSettings] No se pudo refrescar el equipo en segundo plano", {
        category: "offline",
        context: { error: String(e) }
      });
    }
  }, [applyTeam, fetchTeam]);

  // Apertura instantánea: se pinta el último equipo/roles guardados en este
  // dispositivo mientras la red confirma por detrás.
  useEffect(() => {
    let cancelled = false;
    setError(null);

    void (async () => {
      try {
        await staleWhileRevalidate<TeamSnapshot>({
          readCache: readTeamCache,
          fetchFresh: () => fetchTeam(false),
          onData: (snapshot) => {
            if (cancelled) return;
            applyTeam(snapshot);
            setLoading(false);
          },
          onRevalidateError: (e, hadCache) => {
            logWarning("[useSettings] No se pudo confirmar el equipo con el servidor", {
              category: "offline",
              context: { error: String(e), hadCache }
            });
          },
          isCancelled: () => cancelled
        });
      } catch (e) {
        if (!cancelled) setError(translateBusinessError(e, "No se pudieron cargar los usuarios."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyTeam, fetchTeam, readTeamCache]);

  // Si otro dispositivo cambia el equipo o los roles, esta pantalla se actualiza sola.
  useEffect(() => {
    const onRemoteChange = (payload: { source?: string } | undefined) => {
      if (payload?.source === "remote-sync") void refreshTeam();
    };
    const offUser = vimdyCore.on("user", onRemoteChange);
    const offAccess = vimdyCore.on("access", onRemoteChange);
    return () => {
      offUser();
      offAccess();
    };
  }, [refreshTeam]);

  function saveBusiness(data: Partial<Business>) {
    businessStore.update(data);
    setBusiness(businessStore.get());
    if (data.country && AVAILABLE_COUNTRY_CODES.includes(data.country as any)) {
      companyConfigStore.update({ country: data.country as CompanyConfig["country"] });
      setConfig(companyConfigStore.get());
    }
  }

  /**
   * Guarda TODO en la base de datos (negocio + preferencias).
   *
   * Es optimista: valida primero (sin red), aplica el cambio en pantalla y en
   * el caché local al instante, y recién entonces confirma con Supabase. Si el
   * servidor lo rechaza (ej. el usuario no es administrador, plan vencido o
   * sin internet), se deshace TODO lo que se alcanzó a mostrar y se lanza el
   * error para que la pantalla lo muestre. Nunca queda en pantalla algo que
   * la base de datos no aceptó.
   */
  async function persistAll(nextBusiness: Business, nextConfig: CompanyConfig) {
    const businessId = getCurrentBusinessId();
    if (!businessId) throw new Error("No hay un negocio activo. Vuelve a iniciar sesión.");

    // Valida antes de tocar nada (lanza si el nombre está vacío o el IVA es inválido).
    const row = buildBusinessSettingsUpdate(nextBusiness, nextConfig);

    const previousBusiness = businessStore.get();
    const previousConfig = companyConfigStore.get();

    businessStore.update(nextBusiness);
    companyConfigStore.update(nextConfig);
    setBusiness(businessStore.get());
    setConfig(companyConfigStore.get());

    try {
      await saveBusinessSettings(businessId, nextBusiness, nextConfig);
    } catch (e) {
      businessStore.update(previousBusiness);
      companyConfigStore.update(previousConfig);
      setBusiness(businessStore.get());
      setConfig(companyConfigStore.get());
      throw e;
    }

    writeCachedBusinessSettings(businessId, row.settings);
  }

  function saveConfig(data: Partial<CompanyConfig>) {
    companyConfigStore.update(data);
    setConfig(companyConfigStore.get());
    if (data.country && AVAILABLE_COUNTRY_CODES.includes(data.country as any)) {
      businessStore.update({ country: data.country as Business["country"] });
      setBusiness(businessStore.get());
    }
  }

  /**
   * Crear una persona es una acción real del servidor (crea su cuenta de
   * acceso), así que NO se simula: se espera la confirmación. Apenas llega,
   * la persona aparece en la lista al instante con los datos reales que
   * devolvió el servidor, y la lista completa se refresca por detrás.
   */
  async function createUser(
    actorId: string,
    data: { name: string; email: string; password: string; roleId: string }
  ) {
    setError(null);
    try {
      const created = await container.userEngine.get().createUser(actorId, data);
      const nextUsers = [...usersRef.current.filter((u) => u.id !== created.id), created];
      usersRef.current = nextUsers;
      setUsers(nextUsers);
      void refreshTeam();
      return true;
    } catch (e) {
      setError(translateBusinessError(e, "No se pudo crear el usuario."));
      return false;
    }
  }

  /**
   * Activar / desactivar a alguien se refleja al instante en pantalla; el
   * servidor confirma por detrás. Si lo rechaza, se devuelve a como estaba y
   * se muestra el error.
   */
  async function setUserStatus(actorId: string, userId: string, status: UserStatus) {
    setError(null);

    const before = usersRef.current.find((u) => u.id === userId);

    pendingStatuses.current.set(userId, status);
    const optimistic = withPendingStatuses(usersRef.current, pendingStatuses.current);
    usersRef.current = optimistic;
    setUsers(optimistic);

    try {
      await container.userEngine.get().setStatus(actorId, userId, status);
      pendingStatuses.current.delete(userId);
      void refreshTeam();
      return true;
    } catch (e) {
      pendingStatuses.current.delete(userId);
      if (before) {
        const restored = usersRef.current.some((u) => u.id === userId)
          ? usersRef.current.map((u) => (u.id === userId ? before : u))
          : [...usersRef.current, before];
        usersRef.current = restored;
        setUsers(restored);
      }
      setError(translateBusinessError(e, "No se pudo cambiar el estado del usuario."));
      return false;
    }
  }

  function roleName(roleId: string): string {
    return roles.find((r) => r.id === roleId)?.name ?? roleId;
  }

  return {
    business,
    config,
    users,
    roles,
    loading,
    error,
    saveBusiness,
    saveConfig,
    persistAll,
    createUser,
    setUserStatus,
    roleName
  };
}