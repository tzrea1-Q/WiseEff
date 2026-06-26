import { useEffect } from "react";
import { EventType } from "@ag-ui/core";
import { useAgent } from "@copilotkit/react-core/v2";
import { getXiaozeToolLabel } from "@/features/agent/xiaozeToolLabels";
import { useXiaozeRunStepsActions } from "./XiaozeRunStepsContext";
import type { XiaozeRunStepSnapshot } from "./xiaozeRunTimingTypes";

function readStepMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  return metadata as Record<string, unknown>;
}

function readStepId(metadata: Record<string, unknown>, fallback: string) {
  return typeof metadata.stepId === "string" ? metadata.stepId : fallback;
}

function readStepLabel(metadata: Record<string, unknown>, toolName?: string) {
  if (typeof metadata.label === "string" && metadata.label.trim()) {
    return metadata.label;
  }
  if (toolName) {
    return getXiaozeToolLabel(toolName);
  }
  return "执行步骤";
}

function readStepKind(metadata: Record<string, unknown>): XiaozeRunStepSnapshot["kind"] {
  if (metadata.kind === "tool" || metadata.kind === "model" || metadata.kind === "graph") {
    return metadata.kind;
  }
  return "graph";
}

export function XiaozeRunStepsCapture() {
  const { agent } = useAgent({ agentId: "default" });
  const { resetLiveSteps, upsertLiveStep } = useXiaozeRunStepsActions();

  useEffect(() => {
    if (!agent) {
      return;
    }

    const subscription = agent.subscribe({
      onEvent: ({ event }) => {
        if (event.type === EventType.RUN_STARTED) {
          resetLiveSteps();
          return;
        }
        if (event.type === EventType.STEP_STARTED) {
          const metadata = readStepMetadata(event.metadata);
          const toolName = typeof metadata.toolName === "string" ? metadata.toolName : undefined;
          upsertLiveStep({
            id: readStepId(metadata, typeof event.stepName === "string" ? event.stepName : "step"),
            kind: readStepKind(metadata),
            label: readStepLabel(metadata, toolName),
            toolName,
            status: "running",
            startedAtMs: typeof metadata.startedAt === "number" ? metadata.startedAt : Date.now()
          });
          return;
        }
        if (event.type === EventType.STEP_FINISHED) {
          const metadata = readStepMetadata(event.metadata);
          const status = metadata.status;
          upsertLiveStep({
            id: readStepId(metadata, typeof event.stepName === "string" ? event.stepName : "step"),
            kind: readStepKind(metadata),
            label: readStepLabel(metadata, typeof metadata.toolName === "string" ? metadata.toolName : undefined),
            toolName: typeof metadata.toolName === "string" ? metadata.toolName : undefined,
            status:
              status === "failed" || status === "forbidden" || status === "succeeded" || status === "running"
                ? status
                : "succeeded",
            summary: typeof metadata.summary === "string" ? metadata.summary : undefined,
            startedAtMs: typeof metadata.startedAt === "number" ? metadata.startedAt : Date.now(),
            durationMs: typeof metadata.durationMs === "number" ? metadata.durationMs : undefined
          });
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [agent, resetLiveSteps, upsertLiveStep]);

  return null;
}
