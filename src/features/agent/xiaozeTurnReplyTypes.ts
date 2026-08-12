import type { XiaozeRunStepSnapshot } from "./xiaozeRunTimingTypes";

export const XIAOZE_TURN_REPLY_EVENT = "xiaoze_turn_reply";

/** Source citation attached to an assistant answer (knowledge, parameter, log …). */
export type XiaozeCitation = {
  type?: string;
  id: string;
  label: string;
  href?: string;
  snippet?: string;
};

export type XiaozeTurnReplyPayload = {
  runId: string;
  messageId: string;
  reasoningMessageId: string;
  text: string;
  reasoning?: string;
  runSteps?: XiaozeRunStepSnapshot[];
  citations?: XiaozeCitation[];
};
