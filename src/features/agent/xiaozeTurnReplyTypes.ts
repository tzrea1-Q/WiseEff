import type { XiaozeRunStepSnapshot } from "./xiaozeRunTimingTypes";

export const XIAOZE_TURN_REPLY_EVENT = "xiaoze_turn_reply";

export type XiaozeTurnReplyPayload = {
  runId: string;
  messageId: string;
  reasoningMessageId: string;
  text: string;
  reasoning?: string;
  runSteps?: XiaozeRunStepSnapshot[];
};
