import { createClient } from "@supabase/supabase-js";

// @ts-ignore módulo .mjs sin tipos
import { resolveE2eTarget } from "../../../scripts/e2e/targetGuard.mjs";

const { url: SUPABASE_URL, anonKey: ANON_KEY } = resolveE2eTarget() as { url: string; anonKey: string };

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function checkTable(table: string) {
  const { data, error } = await supabase.from(table).select("*").limit(1);
  return { table, exists: !error || error.code !== "42P01", error: error?.message };
}

async function main() {
  const tables = [
    "businesses",
    "business_members",
    "branches",
    "products",
    "categories",
    "sales",
    "sale_items",
    "cash_movements",
    "kitchen_orders",
    "kitchen_order_items",
    "tables",
    "customers",
    "subscription_payments",
    "subscription_audit_log",
    "pending_sales",
    "pending_inventory_adjustments",
    "pending_table_operations",
    "pending_customer_operations",
    "audit_logs",
    "system_errors"
  ];

  console.log("=== Schema validation ===\n");
  for (const t of tables) {
    const result = await checkTable(t);
    console.log(`${result.exists ? "✓" : "✗"} ${result.table}${result.error ? ` (${result.error})` : ""}`);
  }
}

main().catch(console.error);