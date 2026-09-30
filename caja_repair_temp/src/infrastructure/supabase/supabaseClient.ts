import { createClient } from "@supabase/supabase-js";

/* ===========================================================================
   supabaseClient
   ---------------------------------------------------------------------------
   Punto único de conexión con el backend real. Reemplaza a indexedDbCore.ts
   como la fuente de verdad de los datos — IndexedDB puede seguir usándose
   como caché local para modo offline, pero ya no es donde vive el dato.

   VARIABLES DE ENTORNO REQUERIDAS (crea un archivo .env en la raíz del
   proyecto, Vite las lee automáticamente si empiezan con VITE_):

     VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
     VITE_SUPABASE_ANON_KEY=tu-anon-key-publica

   Ambos valores están en tu panel de Supabase -> Project Settings -> API.
   La "anon key" es pública y segura de exponer en el frontend: la
   seguridad real la da Row Level Security (ver supabase/schema.sql), no
   el secreto de esta key.
=========================================================================== */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "SUPABASE_CONFIG_MISSING: define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en tu archivo .env"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

if (!supabase || typeof supabase.from !== "function") {
  throw new Error(
    "SUPABASE_CLIENT_INVALID: el cliente de Supabase no se inicializó correctamente. Verifica VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY."
  );
}

// SOLO PARA PRUEBAS MANUALES (Fase 0 / Fase 5 de QA): expone el cliente en
// window para poder probar los permisos de RLS desde la consola del
// navegador (ej. supabase.from('businesses').update(...)). Nunca se activa
// en producción porque import.meta.env.DEV es false en el build final —
// no hace falta acordarse de quitar esto antes de publicar.
if (import.meta.env.MODE === "development" && typeof window !== "undefined") {
  (window as unknown as { supabase: typeof supabase }).supabase = supabase;
}

/**
 * businessId del negocio actualmente autenticado. Se resuelve una vez al
 * iniciar sesión (ver authBusinessContext.ts) y luego se usa en cada
 * repositorio para filtrar/etiquetar todas las operaciones.
 *
 * No es necesario para la seguridad (eso ya lo garantiza RLS en el
 * servidor), es para que el propio cliente sepa a qué negocio escribir.
 */
let currentBusinessId: string | null = null;
let currentBranchId: string | null = null;

export function setCurrentBusinessId(businessId: string | null): void {
  currentBusinessId = businessId;
}

export function getCurrentBusinessId(): string | undefined {
  return currentBusinessId ?? undefined;
}

export function requireCurrentBusinessId(): string {
  const id = getCurrentBusinessId();
  if (!id) {
    throw new Error(
      "NO_BUSINESS_CONTEXT: no hay un negocio activo. Llama a setCurrentBusinessId() justo después de iniciar sesión."
    );
  }
  return id;
}

export function setCurrentBranchId(branchId: string | null | undefined): void {
  currentBranchId = branchId ?? null;
}

export function getCurrentBranchId(): string | undefined {
  return currentBranchId ?? undefined;
}

/**
 * checkSupabaseReachable
 * ---------------------------------------------------------------------------
 * Ping real contra Supabase (usado por connectionStore, ver
 * core/store/connectionStore.ts). `navigator.onLine` del navegador NO es
 * confiable para saber si hay internet real: puede quedar en `true` con
 * un wifi conectado pero sin salida a internet ("captive portal", router
 * caído, etc.). Esto sí lo confirma, golpeando el servidor de verdad.
 *
 * Pega contra /auth/v1/health: es un endpoint público de Supabase que no
 * necesita sesión ni pasa por Row Level Security, así que sirve incluso
 * antes de iniciar sesión (login, pantalla de OTP, etc.).
 *
 * Importante: CUALQUIER respuesta HTTP cuenta como "hay internet", incluso
 * un 4xx/5xx — eso solo significa que el servidor respondió, que es
 * exactamente lo que queremos confirmar. Lo único que cuenta como "sin
 * internet" es que el fetch ni siquiera pueda completarse: error de red
 * (TypeError "Failed to fetch") o que se cumpla el timeout sin respuesta.
 */
export async function checkSupabaseReachable(timeoutMs: number = 5000): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await fetch(`${supabaseUrl}/auth/v1/health`, {
      method: "GET",
      headers: { apikey: supabaseAnonKey as string },
      signal: controller.signal,
      cache: "no-store"
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface BranchRow {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_main: boolean;
  active: boolean;
}

export async function getBranches(businessId: string): Promise<BranchRow[]> {
  const { data, error } = await supabase
    .from("branches")
    .select("id, name, address, phone, is_main, active")
    .eq("business_id", businessId)
    .order("is_main", { ascending: false });

  if (error) {
    throw new Error(error.message ?? "No se pudieron cargar las sucursales.");
  }

  return (data ?? []) as BranchRow[];
}

export async function createBranch(
  businessId: string,
  input: { name: string; address?: string; phone?: string; is_main?: boolean; active?: boolean }
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("branches")
    .insert({
      business_id: businessId,
      name: input.name.trim(),
      address: input.address?.trim() || null,
      phone: input.phone?.trim() || null,
      is_main: input.is_main ?? false,
      active: input.active ?? true
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "No se pudo crear la sucursal.");
  }

  return data as { id: string };
}

export async function updateBranch(
  branchId: string,
  input: { name?: string; address?: string | null; phone?: string | null; is_main?: boolean; active?: boolean }
): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.address !== undefined) updates.address = input.address?.trim() || null;
  if (input.phone !== undefined) updates.phone = input.phone?.trim() || null;
  if (input.is_main !== undefined) updates.is_main = input.is_main;
  if (input.active !== undefined) updates.active = input.active;

  const { error } = await supabase
    .from("branches")
    .update(updates)
    .eq("id", branchId);

  if (error) {
    throw new Error(error.message ?? "No se pudo actualizar la sucursal.");
  }
}

export async function deleteBranch(branchId: string): Promise<void> {
  const { error } = await supabase
    .from("branches")
    .delete()
    .eq("id", branchId);

  if (error) {
    throw new Error(error.message ?? "No se pudo eliminar la sucursal.");
  }
}