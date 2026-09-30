import type { Category } from "../../../core/entities/Entities";
import {
  ONBOARDING_STEPS_BUILT,
  type OnboardingStepId
} from "./onboardingSteps";
import type { BusinessTypeId } from "../../../core/config/businessTypes";
import type { ModuleId } from "../../../core/config/modules";

export interface OnboardingDraft {
  step: OnboardingStepId;
  businessType: BusinessTypeId | null;
  enabledModules: ModuleId[];
  categories: Category[];
  savedAt: string;
}

const STORAGE_PREFIX = "vimdy:onboarding:v3:";
const LEGACY_KEYS = [
  "vimdy_onboarding_step",
  "vimdy_onboarding_business_type",
  "vimdy_onboarding_enabled_modules",
  "vimdy_onboarding_categories"
] as const;

const memory = new Map<string, OnboardingDraft>();

function keyFor(businessId: string): string {
  return `${STORAGE_PREFIX}${businessId}`;
}

function isValidStep(value: unknown): value is OnboardingStepId {
  return typeof value === "string" && ONBOARDING_STEPS_BUILT.includes(value as OnboardingStepId);
}

function isValidDraft(value: unknown): value is OnboardingDraft {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;

  return (
    isValidStep(candidate.step) &&
    (candidate.businessType === null || typeof candidate.businessType === "string") &&
    Array.isArray(candidate.enabledModules) &&
    Array.isArray(candidate.categories) &&
    typeof candidate.savedAt === "string"
  );
}

function readStorage(businessId: string): OnboardingDraft | null {
  try {
    const raw = window.localStorage.getItem(keyFor(businessId));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    return isValidDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStorage(businessId: string, draft: OnboardingDraft): void {
  memory.set(businessId, draft);

  try {
    window.localStorage.setItem(keyFor(businessId), JSON.stringify(draft));
  } catch {
    // El almacenamiento local puede estar bloqueado; la memoria de esta
    // sesión sigue permitiendo que el onboarding continúe.
  }
}

export const onboardingDraftStore = {
  get(businessId: string): OnboardingDraft | null {
    if (!businessId) return null;

    const stored = readStorage(businessId);
    if (stored) {
      memory.set(businessId, stored);
      return stored;
    }

    return memory.get(businessId) ?? null;
  },

  save(
    businessId: string,
    draft: Omit<OnboardingDraft, "savedAt">
  ): void {
    if (!businessId) return;

    writeStorage(businessId, {
      ...draft,
      savedAt: new Date().toISOString()
    });
  },

  clear(businessId: string | null | undefined): void {
    if (!businessId) return;

    memory.delete(businessId);

    try {
      window.localStorage.removeItem(keyFor(businessId));
    } catch {
      // No-op.
    }
  },

  clearLegacy(): void {
    for (const key of LEGACY_KEYS) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // No-op.
      }
    }
  }
};
