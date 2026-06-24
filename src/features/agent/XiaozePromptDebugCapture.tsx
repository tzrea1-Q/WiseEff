import { useEffect } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import { setXiaozePromptDebugSnapshot } from "./XiaozePromptDebugContext";
import { XIAOZE_PROMPT_DEBUG_EVENT, type XiaozePromptDebugPayload } from "./xiaozePromptDebugTypes";

export function XiaozePromptDebugCapture({ enabled }: { enabled: boolean }) {
  const { agent } = useAgent({ agentId: "default" });

  useEffect(() => {
    if (!enabled || !agent) {
      return;
    }

    const subscription = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name !== XIAOZE_PROMPT_DEBUG_EVENT) {
          return;
        }
        const payload = event.value as XiaozePromptDebugPayload | undefined;
        if (!payload?.snapshot || !payload.runId) {
          return;
        }
        setXiaozePromptDebugSnapshot(payload.runId, payload.snapshot);
      }
    });

    return () => subscription.unsubscribe();
  }, [agent, enabled]);

  return null;
}
