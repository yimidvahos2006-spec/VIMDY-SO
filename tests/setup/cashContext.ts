import { beforeEach, vi } from "vitest";
import * as supabaseClient from "../../src/infrastructure/supabase/supabaseClient";

beforeEach(() => {
  supabaseClient.setCurrentBusinessId("test-business-id");
  supabaseClient.setCurrentBranchId("test-branch-id");
});

export const defaultTestContext = {
  businessId: "test-business-id",
  branchId: "test-branch-id",
} as const;
