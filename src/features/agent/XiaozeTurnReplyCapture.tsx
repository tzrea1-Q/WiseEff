import { useEffect } from "react";
import { EventType } from "@ag-ui/core";
import { useAgent } from "@copilotkit/react-core/v2";
import { useXiaozeTurnReplyActions } from "./XiaozeTurnReplyContext";
import { XIAOZE_TURN_REPLY_EVENT, type XiaozeTurnReplyPayload } from "./xiaozeTurnReplyTypes";

export function XiaozeTurnReplyCapture() {
  const { agent } = useAgent({ agentId: "default" });
  const { setTurnReply, clearTurnReplies } = useXiaozeTurnReplyActions();

  useEffect(() => {
    if (!agent) {
      return;
    }

    const subscription = agent.subscribe({
      onEvent: ({ event }) => {
        if (event.type === EventType.RUN_STARTED) {
          clearTurnReplies();
        }
      },
      onCustomEvent: ({ event }) => {
        if (event.name !== XIAOZE_TURN_REPLY_EVENT) {
          return;
        }
        const payload = event.value as XiaozeTurnReplyPayload | undefined;
        if (!payload?.messageId || typeof payload.text !== "string") {
          return;
        }
        setTurnReply(payload);
      }
    });

    return () => subscription.unsubscribe();
  }, [agent, clearTurnReplies, setTurnReply]);

  return null;
}
