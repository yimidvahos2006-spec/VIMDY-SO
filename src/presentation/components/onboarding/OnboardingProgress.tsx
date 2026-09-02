import {
  ONBOARDING_STEP_ORDER,
  type OnboardingStepId
} from "./onboardingSteps";

const DATA_CAPTURE_STEPS: OnboardingStepId[] = [
  "business_type",
  "modules",
  "tables",
  "employees",
  "categories",
  "first_product",
  "cash_opening"
];

interface OnboardingProgressProps {
  step: OnboardingStepId;
}

export function OnboardingProgress({ step }: OnboardingProgressProps) {
  const currentIndex = DATA_CAPTURE_STEPS.indexOf(step);
  const total = DATA_CAPTURE_STEPS.length;

  if (currentIndex === -1) {
    return null;
  }

  const progress = ((currentIndex + 1) / total) * 100;

  return (
    <div className="w-full max-w-md mb-6">
      <div className="flex items-center justify-between mb-2">
        <span className="vimdy-small text-vimdy-text-secondary">
          Paso {currentIndex + 1} de {total}
        </span>
        <span className="vimdy-micro text-vimdy-text-tertiary">
          {Math.round(progress)}%
        </span>
      </div>
      <div className="w-full h-1 bg-vimdy-surface rounded-full overflow-hidden">
        <div
          className="h-full bg-vimdy-accent transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
