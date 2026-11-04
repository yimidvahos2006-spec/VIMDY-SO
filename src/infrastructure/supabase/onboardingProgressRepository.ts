/**
 * onboardingProgressRepository.ts
 * ---------------------------------------------------------------------------
 * Lectura y escritura del progreso del tour guiado (`public.user_onboarding_progress`).
 *
 * Seguridad (la impone la base con RLS): cada persona solo lee y escribe SU
 * fila, y solo de negocios a los que pertenece. Aun así este repositorio manda
 * siempre user_id y business_id explícitos: nunca depende de que la policy
 * "arregle" una consulta ambigua.
 *
 * Es un dato de cortesía, no del negocio: quien llama debe tratar cualquier
 * error como "no se pudo guardar ahora" y seguir (ver useOnboardingProgress).
 */

import { supabase } from "./supabaseClient";
import {
  ONBOARDING_TOUR_ID,
  parseProgress,
  type OnboardingProgress
} from "../../core/onboarding/onboardingTour";

const TABLE = "user_onboarding_progress";
const COLUMNS = "status,current_step,completed_steps,updated_at";

export async function fetchOnboardingProgress(
  userId: string,
  businessId: string
): Promise<OnboardingProgress | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .eq("tour_id", ONBOARDING_TOUR_ID)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as { status: unknown; current_step: unknown; completed_steps: unknown; updated_at: unknown };
  return parseProgress({
    status: row.status,
    currentStep: row.current_step,
    completedSteps: row.completed_steps,
    updatedAt: typeof row.updated_at === "string" ? Date.parse(row.updated_at) : 0
  });
}

export async function saveOnboardingProgress(
  userId: string,
  businessId: string,
  progress: OnboardingProgress
): Promise<void> {
  const nowIso = new Date().toISOString();

  const { error } = await supabase.from(TABLE).upsert(
    {
      user_id: userId,
      business_id: businessId,
      tour_id: ONBOARDING_TOUR_ID,
      status: progress.status,
      current_step: progress.currentStep,
      completed_steps: progress.completedSteps,
      completed_at: progress.status === "completed" ? nowIso : null,
      skipped_at: progress.status === "skipped" ? nowIso : null
    },
    { onConflict: "user_id,business_id,tour_id" }
  );

  if (error) throw new Error(error.message);
}