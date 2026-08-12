export const XIAOZE_TURN_REPLY_EVENT = "xiaoze_turn_reply";

export type XiaozeTurnReplyPayload = {
  runId: string;
  messageId: string;
  reasoningMessageId: string;
  text: string;
  reasoning?: string;
  runSteps?: Array<{
    id: string;
    kind: "graph" | "tool" | "model";
    label: string;
    toolName?: string;
    status: "running" | "succeeded" | "failed" | "forbidden";
    summary?: string;
    startedAtMs: number;
    durationMs?: number;
  }>;
  /** Source citations for the answer; the UI renders them as source links. */
  citations?: Array<{
    type: string;
    id: string;
    label: string;
    href?: string;
    snippet?: string;
  }>;
};
