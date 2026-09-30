import {
  ONBOARDING_PROGRESS_STEPS,
  type OnboardingStepId
} from "./onboardingSteps";

interface OnboardingProgressProps {
  step: OnboardingStepId;
}

export function OnboardingProgress({ step }: OnboardingProgressProps) {
  const currentIndex = ONBOARDING_PROGRESS_STEPS.indexOf(step);
  const total = ONBOARDING_PROGRESS_STEPS.length;

  if (currentIndex < 0) return null;

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
