import type { Message, ReasoningMessage } from "@ag-ui/core";

type XiaozeReasoningMessageProps = {
  message: ReasoningMessage;
  messages?: Message[];
  isRunning?: boolean;
  className?: string;
};

/** Legacy slot — turn rendering lives in `XiaozeTurnBlock`. */
export function XiaozeReasoningMessage(_props: XiaozeReasoningMessageProps) {
  return null;
}
