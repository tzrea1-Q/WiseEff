import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { XiaozeRunTimingPayload } from "./xiaozeRunTimingTypes";

type XiaozeRunTimingContextValue = {
  setRunTiming: (payload: XiaozeRunTimingPayload) => void;
  getRunTiming: (reasoningMessageId: string) => XiaozeRunTimingPayload | undefined;
};

const XiaozeRunTimingContext = createContext<XiaozeRunTimingContextValue | null>(null);

export function XiaozeRunTimingProvider({ children }: { children: ReactNode }) {
  const [timings, setTimings] = useState<Map<string, XiaozeRunTimingPayload>>(() => new Map());

  const value = useMemo<XiaozeRunTimingContextValue>(
    () => ({
      setRunTiming(payload) {
        setTimings((current) => {
          const next = new Map(current);
          next.set(payload.reasoningMessageId, payload);
          return next;
        });
      },
      getRunTiming(reasoningMessageId) {
        return timings.get(reasoningMessageId);
      }
    }),
    [timings]
  );

  return <XiaozeRunTimingContext.Provider value={value}>{children}</XiaozeRunTimingContext.Provider>;
}

export function useXiaozeRunTiming(reasoningMessageId: string | undefined) {
  const context = useContext(XiaozeRunTimingContext);
  if (!context || !reasoningMessageId) {
    return undefined;
  }
  return context.getRunTiming(reasoningMessageId);
}

export function useXiaozeRunTimingActions() {
  const context = useContext(XiaozeRunTimingContext);
  if (!context) {
    throw new Error("useXiaozeRunTimingActions must be used within XiaozeRunTimingProvider");
  }
  return context;
}
