import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadMock, getCurrentBusinessIdMock } = vi.hoisted(() => ({
  loadMock: vi.fn(),
  getCurrentBusinessIdMock: vi.fn(),
}));

vi.mock("../../src/infrastructure/supabase/businessOperatingProfileRepository", () => ({ loadBusinessOperatingProfile: loadMock }));
vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({ getCurrentBusinessId: getCurrentBusinessIdMock }));

import { hydrateBusinessOperatingProfile } from "../../src/core/bootstrap/businessOperatingProfileBootstrap";
import { businessOperatingProfileStore } from "../../src/core/store/businessOperatingProfileStore";

const profile = {
  businessId: "business-1",
  businessType: null,
  enabledModules: ["caja", "pedidos"] as const,
  operationConfig: { salesChannels: ["presencial"] as const, inventoryType: null, productionMode: null, kdsEnabled: false, printerEnabled: false },
  operationConfigStatus: "loaded" as const,
  capabilities: { sales: true, orders: true, cash: true, inventory: false, customers: false, tables: false, kitchen: false, production: false, ai: false },
  metrics: { netSales: true, transactionCount: true, averageSaleValue: true, cash: true, inventory: false, customers: false, tables: false, kitchen: false, production: false, ai: false },
};

describe("hydrateBusinessOperatingProfile", () => {
  beforeEach(() => {
    loadMock.mockReset();
    getCurrentBusinessIdMock.mockReset();
    businessOperatingProfileStore.clear();
  });

  it("hidrata el perfil cuando la sesión sigue en el mismo negocio", async () => {
    getCurrentBusinessIdMock.mockReturnValue("business-1");
    loadMock.mockResolvedValue(profile);
    await hydrateBusinessOperatingProfile(" business-1 ");
    const snapshot = businessOperatingProfileStore.get();
    expect(loadMock).toHaveBeenCalledWith("business-1");
    expect(snapshot.status).toBe("ready");
    expect(snapshot.profile?.businessId).toBe("business-1");
  });

  it("ignora una respuesta tardía de un negocio anterior", async () => {
    getCurrentBusinessIdMock.mockReturnValue("business-2");
    loadMock.mockResolvedValue(profile);
    await hydrateBusinessOperatingProfile("business-1");
    const snapshot = businessOperatingProfileStore.get();
    expect(snapshot.status).toBe("loading");
    expect(snapshot.profile).toBeNull();
  });

  it("expone error real sin romper el bootstrap", async () => {
    getCurrentBusinessIdMock.mockReturnValue("business-1");
    loadMock.mockRejectedValue(new Error("NETWORK_TEST"));
    await hydrateBusinessOperatingProfile("business-1");
    const snapshot = businessOperatingProfileStore.get();
    expect(snapshot.status).toBe("error");
    expect(snapshot.error).toBe("NETWORK_TEST");
  });

  it("no consulta Supabase si el businessId está vacío", async () => {
    await hydrateBusinessOperatingProfile("   ");
    expect(loadMock).not.toHaveBeenCalled();
    expect(businessOperatingProfileStore.get().status).toBe("idle");
  });
});
