import { describe, expect, it, vi } from "vitest";

const mockInsert = vi.fn(() => Promise.resolve({ error: null }));
const mockFrom = vi.fn(() => ({ insert: mockInsert }));
const mockGetUser = vi.fn(() => Promise.resolve({ data: { user: null } }));
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom };

vi.mock("../../src/infrastructure/supabase/supabaseClient", async () => ({
  supabase: mockSupabase,
  getCurrentBusinessId: vi.fn(() => null)
}));

import { logError } from "../../src/infrastructure/logging/opsLogger";

describe("opsLogger", () => {
  it("sin sesión no intenta INSERT en system_errors", async () => {
    logError(new Error("test sin sesión"), { category: "unknown" });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("con sesión intenta INSERT en system_errors", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "user-1" } } } as any);

    logError(new Error("test con sesión"), { category: "unknown" });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockFrom).toHaveBeenCalledWith("system_errors");
    expect(mockInsert).toHaveBeenCalled();
  });
});
