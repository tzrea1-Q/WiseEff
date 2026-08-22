/**
 * The Xiaoze wire contract: CUSTOM event names and payload shapes shared
 * verbatim by the server (emitter, `server/modules/agent/xiaoze/`) and the
 * frontend (consumer, `src/features/agent/`). Both sides import this package
 * instead of keeping hand-copied mirrors, so a payload change is a change to
 * this file — not a silent drift between two copies.
 *
 * Shapes only: classification heuristics and rendering behavior stay on
 * their own side of the wire.
 */

export const XIAOZE_TURN_STATE_EVENT = "xiaoze_turn_state";
export const XIAOZE_TURN_REPLY_EVENT = "xiaoze_turn_reply";
export const XIAOZE_RUN_TIMING_EVENT = "xiaoze_run_timing";
export const XIAOZE_PROMPT_DEBUG_EVENT = "xiaoze_prompt_debug";
export const XIAOZE_INTERRUPT_EVENT = "on_interrupt";

export type XiaozeTurnPhase = "thinking" | "tool" | "composing" | "done" | "error";

/** One run step on the turn timeline (graph node, tool execution, or model turn). */
export type XiaozeRunStep = {
  id: string;
  kind: "graph" | "tool" | "model";
  label: string;
  toolName?: string;
  status: "running" | "succeeded" | "failed" | "forbidden";
  summary?: string;
  startedAtMs: number;
  durationMs?: number;
};

export type XiaozeCitationType = "parameter" | "log" | "audit" | "debugging" | "knowledge";

/** Source citation attached to an assistant answer; the UI renders them as source links. */
export type XiaozeCitation = {
  type: XiaozeCitationType;
  id: string;
  label: string;
  href?: string;
  snippet?: string;
  confidence?: number;
};

/** Mutating-tool approval payload carried by the `on_interrupt` CUSTOM event. */
export type XiaozeInterruptPayload = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  payload: Record<string, unknown> & {
    projectId?: string;
    parameterId?: string;
    targetValue?: string;
    reason?: string;
    title?: string;
    contentMarkdown?: string;
    tags?: string[];
    sourceLogId?: string;
  };
  citations: XiaozeCitation[];
};

/** Live turn progress snapshot, emitted after every streamed frame. */
export type XiaozeTurnStatePayload = {
  runId: string;
  messageId: string;
  reasoningMessageId: string;
  phase: XiaozeTurnPhase;
  steps?: XiaozeRunStep[];
  text?: string;
  reasoning?: string;
  answerStreaming?: boolean;
};

/** Authoritative end-of-turn reply. */
export type XiaozeTurnReplyPayload = {
  runId: string;
  messageId: string;
  reasoningMessageId: string;
  text: string;
  reasoning?: string;
  runSteps?: XiaozeRunStep[];
  citations?: XiaozeCitation[];
};

export type XiaozeRunTimingPayload = {
  runId: string;
  reasoningMessageId: string;
  startedAt: number;
  durationMs: number;
  phase: "finished" | "error";
};

export type XiaozePromptDebugTool = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  requiresApproval?: boolean;
};

export type XiaozePromptDebugSnapshot = {
  threadId: string;
  userMessage: string;
  context: {
    projectId?: string;
    pageKey?: string;
  };
  system: {
    policy: string;
    toolCatalog: string;
  };
  llmMessages: unknown[];
  tools: XiaozePromptDebugTool[];
  model?: string;
  promptVersion?: string;
};

export type XiaozePromptDebugPayload = {
  runId: string;
  messageId: string;
  snapshot: XiaozePromptDebugSnapshot;
};
