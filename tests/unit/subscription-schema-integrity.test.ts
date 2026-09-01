import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SCHEMA_PATH = join(process.cwd(), "supabase", "schema.sql");
const rawSchema = readFileSync(SCHEMA_PATH, "utf-8");

describe("P0 — Schema: migraciones consolidadas", () => {
  it("businesses tiene renewal_date, next_charge_at, payment_method, payment_status, subscription_status y trial_used_at", () => {
    expect(rawSchema).toMatch(/renewal_date timestamptz/);
    expect(rawSchema).toMatch(/next_charge_at timestamptz/);
    expect(rawSchema).toMatch(/payment_method text/);
    expect(rawSchema).toMatch(/payment_status text not null default 'none'/);
    expect(rawSchema).toMatch(/subscription_status text not null default 'trial'/);
    expect(rawSchema).toMatch(/trial_used_at timestamptz/);
  });

  it("existe subscription_payments con columnas de idempotencia y referencias de proveedor", () => {
    expect(rawSchema).toMatch(/create table if not exists subscription_payments/);
    expect(rawSchema).toMatch(/idempotency_key text/);
    expect(rawSchema).toMatch(/wompi_reference text/);
    expect(rawSchema).toMatch(/mercadopago_reference text/);
    expect(rawSchema).toMatch(/paypal_order_id text/);
    expect(rawSchema).toMatch(/paypal_capture_id text/);
    expect(rawSchema).toMatch(/renewal_number integer not null default 0/);
  });

  it("existe subscription_audit_log", () => {
    expect(rawSchema).toMatch(/create table if not exists subscription_audit_log/);
    expect(rawSchema).toMatch(/actor_type text not null default 'system'/);
    expect(rawSchema).toMatch(/ip_address inet/);
  });

  it("existe user_trial_usage", () => {
    expect(rawSchema).toMatch(/create table if not exists user_trial_usage/);
    expect(rawSchema).toMatch(/user_id uuid primary key references auth.users\(id\) on delete cascade/);
  });

  it("existe is_business_subscription_active y usa fechas reales", () => {
    expect(rawSchema).toMatch(/create or replace function public.is_business_subscription_active\(p_business_id uuid\)/);
    expect(rawSchema).toMatch(/renewal_date > CURRENT_TIMESTAMP/);
    expect(rawSchema).toMatch(/trial_ends_at > CURRENT_TIMESTAMP/);
  });

  it("existe activate/renew/expire/cancel subscription server-side", () => {
    expect(rawSchema).toMatch(/create or replace function public.activate_subscription_server_side/);
    expect(rawSchema).toMatch(/create or replace function public.renew_subscription_server_side/);
    expect(rawSchema).toMatch(/create or replace function public.expire_subscription_server_side/);
    expect(rawSchema).toMatch(/create or replace function public.cancel_subscription_server_side/);
  });

  it("existe get_business_subscription_status con lógica de fechas", () => {
    expect(rawSchema).toMatch(/create or replace function public.get_business_subscription_status/);
    expect(rawSchema).toMatch(/when plan = 'trial' and trial_ends_at is not null and trial_ends_at > CURRENT_TIMESTAMP then true/);
    expect(rawSchema).toMatch(/when plan in \('monthly', 'yearly'\) and \(renewal_date is null or renewal_date > CURRENT_TIMESTAMP\) then true/);
  });

  it("existe can_start_trial / mark_trial_used", () => {
    expect(rawSchema).toMatch(/create or replace function public.can_start_trial/);
    expect(rawSchema).toMatch(/create or replace function public.mark_trial_used/);
  });

  it("existe get_plan_period_days", () => {
    expect(rawSchema).toMatch(/create or replace function public.get_plan_period_days/);
    expect(rawSchema).toMatch(/return 30;/);
    expect(rawSchema).toMatch(/return 30 \* 14;/);
  });

  it("subscription_payments tiene RLS y grants correctos", () => {
    expect(rawSchema).toMatch(/alter table subscription_payments enable row level security/);
    expect(rawSchema).toMatch(/subscription_payments_tenant_isolation on subscription_payments/);
    expect(rawSchema).toMatch(/subscription_payments_service_insert on subscription_payments/);
    expect(rawSchema).toMatch(/grant all on subscription_payments to service_role/);
    expect(rawSchema).toMatch(/grant select on subscription_payments to authenticated/);
  });

  it("subscription_audit_log tiene RLS y grants correctos", () => {
    expect(rawSchema).toMatch(/alter table subscription_audit_log enable row level security/);
    expect(rawSchema).toMatch(/subscription_audit_log_tenant_isolation on subscription_audit_log/);
    expect(rawSchema).toMatch(/subscription_audit_log_service_insert on subscription_audit_log/);
    expect(rawSchema).toMatch(/grant all on subscription_audit_log to service_role/);
    expect(rawSchema).toMatch(/grant select on subscription_audit_log to authenticated/);
  });

  it("user_trial_usage tiene RLS y grants correctos", () => {
    expect(rawSchema).toMatch(/alter table user_trial_usage enable row level security/);
    expect(rawSchema).toMatch(/user_trial_usage_service_all on user_trial_usage/);
    expect(rawSchema).toMatch(/grant all on user_trial_usage to service_role/);
    expect(rawSchema).toMatch(/revoke all on user_trial_usage from authenticated, anon, public/);
  });
});
