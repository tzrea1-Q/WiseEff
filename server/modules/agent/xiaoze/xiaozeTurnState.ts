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

type SinkLikeEvent =
  | { type: "step_started"; step: XiaozeTurnStateStep }
  | { type: "step_finished"; stepId: string; status: XiaozeTurnStateStep["status"]; summary?: string; durationMs?: number }
  | { type: "answer_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string };

export class XiaozeTurnStateTracker {
  private phase: XiaozeTurnPhase = "thinking";
  private steps = new Map<string, XiaozeTurnStateStep>();
  private hadToolActivity = false;
  private streamedText = "";

  constructor(
    private readonly ids: {
      runId: string;
      messageId: string;
      reasoningMessageId: string;
    }
  ) {}

  onSinkEvent(event: SinkLikeEvent) {
    if (event.type === "step_started") {
      this.hadToolActivity = true;
      this.phase = "tool";
      this.steps.set(event.step.id, event.step);
      return;
    }
    if (event.type === "step_finished") {
      const existing = this.steps.get(event.stepId);
      if (existing) {
        this.steps.set(event.stepId, {
          ...existing,
          status: event.status,
          summary: event.summary ?? existing.summary,
          durationMs: event.durationMs ?? existing.durationMs
        });
      }
      return;
    }
    if (event.type === "answer_delta") {
      if (this.hadToolActivity) {
        this.phase = "composing";
      }
      this.streamedText += event.delta;
      return;
    }
    if (event.type === "reasoning_delta") {
      return;
    }
  }

  markDone(input: { text: string; reasoning?: string; steps?: XiaozeTurnStateStep[] }) {
    this.phase = "done";
    if (input.steps?.length) {
      for (const step of input.steps) {
        this.steps.set(step.id, step);
      }
    }
    this.streamedText = input.text;
  }

  markError() {
    this.phase = "error";
  }

  snapshot(extra?: Partial<Pick<XiaozeTurnStatePayload, "text" | "reasoning" | "answerStreaming">>): XiaozeTurnStatePayload {
    return {
      runId: this.ids.runId,
      messageId: this.ids.messageId,
      reasoningMessageId: this.ids.reasoningMessageId,
      phase: this.phase,
      steps: [...this.steps.values()],
      text: extra?.text ?? (this.streamedText.trim() || undefined),
      reasoning: extra?.reasoning,
      answerStreaming: extra?.answerStreaming ?? (this.phase === "composing")
    };
  }
}

export function turnStateCustomEvent(payload: XiaozeTurnStatePayload) {
  return {
    name: XIAOZE_TURN_STATE_EVENT,
    value: payload
  };
}
