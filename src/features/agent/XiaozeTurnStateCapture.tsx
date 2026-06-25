import { useEffect } from "react";
import { EventType } from "@ag-ui/core";
import { useAgent } from "@copilotkit/react-core/v2";
import { useXiaozeTurnStateActions } from "./XiaozeTurnStateContext";
import { XIAOZE_TURN_STATE_EVENT, type XiaozeTurnStatePayload } from "./xiaozeTurnStateTypes";

export function XiaozeTurnStateCapture() {
  const { agent } = useAgent({ agentId: "default" });
  const { setTurnState, clearTurnStates } = useXiaozeTurnStateActions();

  useEffect(() => {
    if (!agent) {
      return;
    }

    const subscription = agent.subscribe({
      onEvent: ({ event }) => {
        if (event.type === EventType.RUN_STARTED) {
          clearTurnStates();
        }
      },
      onCustomEvent: ({ event }) => {
        if (event.name !== XIAOZE_TURN_STATE_EVENT) {
          return;
        }
        const payload = event.value as XiaozeTurnStatePayload | undefined;
        if (!payload?.messageId || !payload.phase) {
          return;
        }
        setTurnState(payload);
      }
    });

    return () => subscription.unsubscribe();
  }, [agent, clearTurnStates, setTurnState]);

  return null;
}
