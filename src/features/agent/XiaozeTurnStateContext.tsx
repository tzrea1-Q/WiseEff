import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { XiaozeTurnStatePayload } from "./xiaozeTurnStateTypes";

type XiaozeTurnStateContextValue = {
  getTurnState: (messageId: string) => XiaozeTurnStatePayload | undefined;
  setTurnState: (payload: XiaozeTurnStatePayload) => void;
  clearTurnStates: () => void;
};

const XiaozeTurnStateContext = createContext<XiaozeTurnStateContextValue | null>(null);

export function XiaozeTurnStateProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Map<string, XiaozeTurnStatePayload>>(() => new Map());

  const value = useMemo<XiaozeTurnStateContextValue>(
    () => ({
      getTurnState(messageId) {
        return states.get(messageId);
      },
      setTurnState(payload) {
        setStates((current) => {
          const next = new Map(current);
          next.set(payload.messageId, payload);
          return next;
        });
      },
      clearTurnStates() {
        setStates(new Map());
      }
    }),
    [states]
  );

  return <XiaozeTurnStateContext.Provider value={value}>{children}</XiaozeTurnStateContext.Provider>;
}

export function useXiaozeTurnState(messageId: string | undefined) {
  const context = useContext(XiaozeTurnStateContext);
  if (!context || !messageId) {
    return undefined;
  }
  return context.getTurnState(messageId);
}

export function useXiaozeTurnStateActions() {
  const context = useContext(XiaozeTurnStateContext);
  if (!context) {
    throw new Error("useXiaozeTurnStateActions must be used within XiaozeTurnStateProvider");
  }
  return context;
}
