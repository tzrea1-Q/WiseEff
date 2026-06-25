import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { XiaozeRunStepSnapshot } from "./xiaozeRunTimingTypes";

type XiaozeRunStepsContextValue = {
  liveSteps: XiaozeRunStepSnapshot[];
  resetLiveSteps: () => void;
  upsertLiveStep: (step: XiaozeRunStepSnapshot) => void;
};

const XiaozeRunStepsContext = createContext<XiaozeRunStepsContextValue | null>(null);

export function XiaozeRunStepsProvider({ children }: { children: ReactNode }) {
  const [liveSteps, setLiveSteps] = useState<XiaozeRunStepSnapshot[]>([]);

  const value = useMemo<XiaozeRunStepsContextValue>(
    () => ({
      liveSteps,
      resetLiveSteps() {
        setLiveSteps([]);
      },
      upsertLiveStep(step) {
        setLiveSteps((current) => {
          const index = current.findIndex((entry) => entry.id === step.id);
          if (index < 0) {
            return [...current, step];
          }
          const next = [...current];
          next[index] = { ...next[index], ...step };
          return next;
        });
      }
    }),
    [liveSteps]
  );

  return <XiaozeRunStepsContext.Provider value={value}>{children}</XiaozeRunStepsContext.Provider>;
}

export function useXiaozeLiveRunSteps() {
  const context = useContext(XiaozeRunStepsContext);
  if (!context) {
    return [];
  }
  return context.liveSteps;
}

export function useXiaozeRunStepsActions() {
  const context = useContext(XiaozeRunStepsContext);
  if (!context) {
    throw new Error("useXiaozeRunStepsActions must be used within XiaozeRunStepsProvider");
  }
  return context;
}
