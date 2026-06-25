import { randomUUID } from "node:crypto";

export type XiaozeRunStepKind = "graph" | "tool" | "model";
export type XiaozeRunStepStatus = "running" | "succeeded" | "failed" | "forbidden";

export type XiaozeRunStepRecord = {
  id: string;
  kind: XiaozeRunStepKind;
  label: string;
  toolName?: string;
  status: XiaozeRunStepStatus;
  summary?: string;
  startedAtMs: number;
  durationMs?: number;
};

export type RunEventSinkEvent =
  | { type: "step_started"; step: XiaozeRunStepRecord }
  | {
      type: "step_finished";
      stepId: string;
      status: Exclude<XiaozeRunStepStatus, "running">;
      summary?: string;
      durationMs: number;
    }
  | { type: "reasoning_delta"; delta: string }
  | { type: "answer_delta"; delta: string }
  | { type: "tool_call"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | {
      type: "tool_result";
      toolCallId: string;
      toolName: string;
      summary: string;
      status: Exclude<XiaozeRunStepStatus, "running">;
    };

export type RunEventSink = {
  push: (event: RunEventSinkEvent) => void;
  close: () => void;
  drain: (timeoutMs?: number) => Promise<RunEventSinkEvent[]>;
  getSteps: () => XiaozeRunStepRecord[];
};

export function createRunEventSink(): RunEventSink {
  const queue: RunEventSinkEvent[] = [];
  const steps = new Map<string, XiaozeRunStepRecord>();
  let closed = false;
  let notify: (() => void) | undefined;

  const wake = () => {
    notify?.();
    notify = undefined;
  };

  return {
    push(event) {
      if (event.type === "step_started") {
        steps.set(event.step.id, event.step);
      }
      if (event.type === "step_finished") {
        const existing = steps.get(event.stepId);
        if (existing) {
          steps.set(event.stepId, {
            ...existing,
            status: event.status,
            summary: event.summary,
            durationMs: event.durationMs
          });
        }
      }
      queue.push(event);
      wake();
    },
    close() {
      closed = true;
      wake();
    },
    async drain(timeoutMs = 25) {
      if (queue.length > 0) {
        return queue.splice(0, queue.length);
      }
      if (closed) {
        return [];
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        notify = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      return queue.splice(0, queue.length);
    },
    getSteps() {
      return [...steps.values()];
    }
  };
}

export function startRunStep(input: {
  kind: XiaozeRunStepKind;
  label: string;
  toolName?: string;
  startedAtMs?: number;
}): { step: XiaozeRunStepRecord; finish: (result: { status: Exclude<XiaozeRunStepStatus, "running">; summary?: string }) => RunEventSinkEvent } {
  const step: XiaozeRunStepRecord = {
    id: randomUUID(),
    kind: input.kind,
    label: input.label,
    toolName: input.toolName,
    status: "running",
    startedAtMs: input.startedAtMs ?? Date.now()
  };

  return {
    step,
    finish(result) {
      const durationMs = Math.max(0, Date.now() - step.startedAtMs);
      return {
        type: "step_finished",
        stepId: step.id,
        status: result.status,
        summary: result.summary,
        durationMs
      };
    }
  };
}
