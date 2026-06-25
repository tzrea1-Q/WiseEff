import type { XiaozeRunStepSnapshot } from "./xiaozeRunTimingTypes";

export const XIAOZE_TURN_STATE_EVENT = "xiaoze_turn_state";

export type XiaozeTurnPhase = "thinking" | "tool" | "composing" | "done" | "error";

export type XiaozeTurnStatePayload = {
  runId: string;
  messageId: string;
  reasoningMessageId: string;
  phase: XiaozeTurnPhase;
  steps?: XiaozeRunStepSnapshot[];
  text?: string;
  reasoning?: string;
  answerStreaming?: boolean;
};
