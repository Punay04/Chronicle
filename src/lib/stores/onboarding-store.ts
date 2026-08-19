import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OnboardingStep = "login" | "permissions" | "engine" | "connect-apps" | "pipe";

interface OnboardingState {
  currentStep: OnboardingStep;
  isCompleted: boolean;
  setStep: (step: OnboardingStep) => void;
  complete: () => void;
  setCompleted: (completed: boolean) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      currentStep: "login",
      isCompleted: false,
      setStep: (step) => set({ currentStep: step }),
      complete: () => set({ isCompleted: true }),
      setCompleted: (isCompleted) => set({ isCompleted }),
      reset: () => set({ currentStep: "login", isCompleted: false }),
    }),
    { name: "chronicle-onboarding" }
  )
);

export const ONBOARDING_SIZES: Record<OnboardingStep, { width: number; height: number }> = {
  login: { width: 500, height: 480 },
  permissions: { width: 500, height: 560 },
  engine: { width: 500, height: 620 },
  "connect-apps": { width: 500, height: 680 },
  pipe: { width: 500, height: 500 },
};
