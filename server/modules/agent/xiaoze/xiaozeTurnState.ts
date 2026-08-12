export const XIAOZE_TURN_STATE_EVENT = "xiaoze_turn_state";

export type XiaozeTurnPhase = "thinking" | "tool" | "composing" | "done" | "error";

export type XiaozeTurnStateStep = {
  id: string;
  kind: "graph" | "tool" | "model";
  label: string;
  toolName?: string;
  status: "running" | "succeeded" | "failed" | "forbidden";
  summary?: string;
  startedAtMs: number;
  durationMs?: number;
};

export type XiaozeTurnStatePayload = {
  runId: string;
  messageId: string;
  reasoningMessageId: string;
  phase: XiaozeTurnPhase;
  steps?: XiaozeTurnStateStep[];
  text?: string;
  reasoning?: string;
  answerStreaming?: boolean;
};

export function turnStateCustomEvent(payload: XiaozeTurnStatePayload) {
  return {
    name: XIAOZE_TURN_STATE_EVENT,
    value: payload
  };
}
