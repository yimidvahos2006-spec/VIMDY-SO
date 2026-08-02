import { useCallback, useEffect, useState } from "react";
import { container, identityReady } from "../../infrastructure/di/CompositionRoot";
import { businessStore, Business } from "./businessStore";
import { companyConfigStore, CompanyConfig } from "./companyConfigStore";
import { Role, User, UserStatus } from "../entities/Entities";

export function useSettings() {
  const [business, setBusiness] = useState<Business>(businessStore.get());
  const [config, setConfig] = useState<CompanyConfig>(companyConfigStore.get());
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUsersAndRoles = useCallback(async () => {
    await identityReady;
    const [allUsers, allRoles] = await Promise.all([
      container.userEngine.listUsers(),
      container.roleEngine.listRoles()
    ]);
    setUsers(allUsers);
    setRoles(allRoles);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    loadUsersAndRoles()
      .catch((e: any) => setError(e.message ?? "No se pudieron cargar los usuarios."))
      .finally(() => setLoading(false));
  }, [loadUsersAndRoles]);

  function saveBusiness(data: Partial<Business>) {
    businessStore.update(data);
    setBusiness(businessStore.get());
  }

  function saveConfig(data: Partial<CompanyConfig>) {
    companyConfigStore.update(data);
    setConfig(companyConfigStore.get());
  }

  async function createUser(
    actorId: string,
    data: { name: string; email: string; password: string; roleId: string }
  ) {
    setError(null);
    try {
      await container.userEngine.createUser(actorId, data);
      await loadUsersAndRoles();
      return true;
    } catch (e: any) {
      setError(e.message ?? "No se pudo crear el usuario.");
      return false;
    }
  }

  async function setUserStatus(actorId: string, userId: string, status: UserStatus) {
    setError(null);
    try {
      await container.userEngine.setStatus(actorId, userId, status);
      await loadUsersAndRoles();
      return true;
    } catch (e: any) {
      setError(e.message ?? "No se pudo cambiar el estado del usuario.");
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
    createUser,
    setUserStatus,
    roleName
  };
}