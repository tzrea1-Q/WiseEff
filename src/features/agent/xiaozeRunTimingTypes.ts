export const XIAOZE_RUN_TIMING_EVENT = "xiaoze_run_timing";

export type XiaozeRunTimingPayload = {
  runId: string;
  reasoningMessageId: string;
  startedAt: number;
  durationMs: number;
  phase: "finished" | "error";
};

export type XiaozeRunStepSnapshot = {
  id: string;
  kind: "graph" | "tool" | "model";
  label: string;
  toolName?: string;
  status: "running" | "succeeded" | "failed" | "forbidden";
  summary?: string;
  startedAtMs: number;
  durationMs?: number;
};
