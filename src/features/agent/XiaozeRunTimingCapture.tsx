import { useEffect } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import { useXiaozeRunTimingActions } from "./XiaozeRunTimingContext";
import { XIAOZE_RUN_TIMING_EVENT, type XiaozeRunTimingPayload } from "./xiaozeRunTimingTypes";

export function XiaozeRunTimingCapture() {
  const { agent } = useAgent({ agentId: "default" });
  const { setRunTiming } = useXiaozeRunTimingActions();

  useEffect(() => {
    if (!agent) {
      return;
    }

    const subscription = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name !== XIAOZE_RUN_TIMING_EVENT) {
          return;
        }
        const payload = event.value as XiaozeRunTimingPayload | undefined;
        if (!payload?.reasoningMessageId || typeof payload.durationMs !== "number") {
          return;
        }
        setRunTiming(payload);
      }
    });

    return () => subscription.unsubscribe();
  }, [agent, setRunTiming]);

  return null;
}
