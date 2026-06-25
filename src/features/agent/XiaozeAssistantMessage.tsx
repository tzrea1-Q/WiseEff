import type { ComponentProps } from "react";
import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";

type XiaozeAssistantMessageProps = ComponentProps<typeof CopilotChatAssistantMessage>;

/** Legacy slot — turn rendering lives in `XiaozeTurnBlock`. */
export function XiaozeAssistantMessage(_props: XiaozeAssistantMessageProps) {
  return null;
}
