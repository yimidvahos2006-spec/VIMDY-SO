import type { Category } from "../../../core/entities/Entities";
import {
  ONBOARDING_STEPS_BUILT,
  type OnboardingStepId
} from "./onboardingSteps";
import {
  isStoredBusinessTypeId,
  type BusinessTypeId
} from "../../../core/config/businessTypes";
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

function keyFor(userId: string, businessId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(businessId)}`;
}

function isValidStep(value: unknown): value is OnboardingStepId {
  return typeof value === "string" && ONBOARDING_STEPS_BUILT.includes(value as OnboardingStepId);
}

function isValidDraft(value: unknown): value is OnboardingDraft {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;

  return (
    isValidStep(candidate.step) &&
    (candidate.businessType === null ||
      (typeof candidate.businessType === "string" && isStoredBusinessTypeId(candidate.businessType))) &&
    Array.isArray(candidate.enabledModules) &&
    Array.isArray(candidate.categories) &&
    typeof candidate.savedAt === "string"
  );
}

function readStorage(userId: string, businessId: string): OnboardingDraft | null {
  try {
    const raw = window.localStorage.getItem(keyFor(userId, businessId));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    return isValidDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStorage(userId: string, businessId: string, draft: OnboardingDraft): void {
  const key = keyFor(userId, businessId);
  memory.set(key, draft);

  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // El almacenamiento local puede estar bloqueado; la memoria de esta
    // sesión sigue permitiendo que el onboarding continúe.
  }
}

export const onboardingDraftStore = {
  get(userId: string, businessId: string): OnboardingDraft | null {
    if (!userId || !businessId) return null;

    const key = keyFor(userId, businessId);
    const stored = readStorage(userId, businessId);
    if (stored) {
      memory.set(key, stored);
      return stored;
    }

    return memory.get(key) ?? null;
  },

  save(
    userId: string,
    businessId: string,
    draft: Omit<OnboardingDraft, "savedAt">
  ): void {
    if (!userId || !businessId) return;

    const businessType =
      typeof draft.businessType === "string" && isStoredBusinessTypeId(draft.businessType)
        ? draft.businessType
        : null;

    writeStorage(userId, businessId, {
      ...draft,
      businessType,
      savedAt: new Date().toISOString()
    });
  },

  clear(userId: string | null | undefined, businessId: string | null | undefined): void {
    if (!userId || !businessId) return;

    const key = keyFor(userId, businessId);
    memory.delete(key);

    try {
      window.localStorage.removeItem(key);
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
