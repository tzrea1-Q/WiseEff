import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { XiaozeTurnReplyPayload } from "./xiaozeTurnReplyTypes";

type XiaozeTurnReplyContextValue = {
  getTurnReply: (messageId: string) => XiaozeTurnReplyPayload | undefined;
  getLatestTurnReply: () => XiaozeTurnReplyPayload | undefined;
  setTurnReply: (payload: XiaozeTurnReplyPayload) => void;
  clearTurnReplies: () => void;
};

const XiaozeTurnReplyContext = createContext<XiaozeTurnReplyContextValue | null>(null);

export function XiaozeTurnReplyProvider({ children }: { children: ReactNode }) {
  const [replies, setReplies] = useState<Map<string, XiaozeTurnReplyPayload>>(() => new Map());

  const value = useMemo<XiaozeTurnReplyContextValue>(
    () => ({
      getTurnReply(messageId) {
        return replies.get(messageId);
      },
      getLatestTurnReply() {
        const entries = [...replies.values()];
        return entries.length > 0 ? entries[entries.length - 1] : undefined;
      },
      setTurnReply(payload) {
        setReplies((current) => {
          const next = new Map(current);
          next.set(payload.messageId, payload);
          return next;
        });
      },
      clearTurnReplies() {
        setReplies(new Map());
      }
    }),
    [replies]
  );

  return <XiaozeTurnReplyContext.Provider value={value}>{children}</XiaozeTurnReplyContext.Provider>;
}

export function useXiaozeTurnReply(messageId: string | undefined) {
  const context = useContext(XiaozeTurnReplyContext);
  if (!context || !messageId) {
    return undefined;
  }
  return context.getTurnReply(messageId);
}

export function useXiaozeLatestTurnReply() {
  const context = useContext(XiaozeTurnReplyContext);
  if (!context) {
    return undefined;
  }
  return context.getLatestTurnReply();
}

export function useXiaozeTurnReplyActions() {
  const context = useContext(XiaozeTurnReplyContext);
  if (!context) {
    throw new Error("useXiaozeTurnReplyActions must be used within XiaozeTurnReplyProvider");
  }
  return context;
}
