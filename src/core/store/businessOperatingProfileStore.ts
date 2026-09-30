/**
 * businessOperatingProfileStore.ts
 * ---------------------------------------------------------------------------
 * Estado reactivo en memoria del perfil operativo REAL del negocio activo.
 * No persiste datos y no inventa defaults.
 */

import { ObservableStore } from "./ObservableStore";
import type { BusinessOperatingProfile } from "../config/businessOperatingProfile";

export type BusinessOperatingProfileStatus = "idle" | "loading" | "ready" | "error";

export interface BusinessOperatingProfileSnapshot {
  readonly status: BusinessOperatingProfileStatus;
  readonly businessId: string | null;
  readonly profile: BusinessOperatingProfile | null;
  readonly error: string | null;
  readonly loadedAt: number | null;
}

const INITIAL_SNAPSHOT: BusinessOperatingProfileSnapshot = {
  status: "idle",
  businessId: null,
  profile: null,
  error: null,
  loadedAt: null,
};

class BusinessOperatingProfileStore extends ObservableStore<BusinessOperatingProfileSnapshot> {
  constructor() {
    super(INITIAL_SNAPSHOT);
  }

  get(): BusinessOperatingProfileSnapshot {
    return this.snapshot;
  }

  loading(businessId: string): void {
    this.publish({
      status: "loading",
      businessId,
      profile: null,
      error: null,
      loadedAt: null,
    });
  }

  ready(profile: BusinessOperatingProfile): void {
    this.publish({
      status: "ready",
      businessId: profile.businessId,
      profile,
      error: null,
      loadedAt: Date.now(),
    });
  }

  fail(businessId: string, error: string): void {
    this.publish({
      status: "error",
      businessId,
      profile: null,
      error: error.trim() || "No se pudo cargar la configuración operativa.",
      loadedAt: null,
    });
  }

  clear(): void {
    this.publish(INITIAL_SNAPSHOT);
  }
}

export const businessOperatingProfileStore = new BusinessOperatingProfileStore();
