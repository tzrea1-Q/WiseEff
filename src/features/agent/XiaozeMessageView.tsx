import type { ComponentProps } from "react";
import {
  CopilotChatAssistantMessage,
  CopilotChatMessageView,
  CopilotChatReasoningMessage,
  CopilotChatUserMessage
} from "@copilotkit/react-core/v2";
import { XiaozeAssistantMessage } from "./XiaozeAssistantMessage";
import { XiaozeReasoningMessage } from "./XiaozeReasoningMessage";
import { XiaozeUserMessage } from "./XiaozeUserMessage";
import { XiaozeThinkingIndicator } from "./XiaozeThinkingIndicator";
import { XiaozeWelcomePanel } from "./XiaozeWelcomePanel";
import { renderXiaozeTurnBlocks } from "./XiaozeTurnBlock";
import { shouldShowXiaozeThinkingFallback } from "./xiaozeThinkingState";
import { shouldShowXiaozeWelcomePanel } from "./xiaozeWelcomeRules";

export { shouldShowXiaozeWelcomePanel } from "./xiaozeWelcomeRules";

type XiaozeMessageViewProps = ComponentProps<typeof CopilotChatMessageView>;

export function XiaozeMessageView(props: XiaozeMessageViewProps) {
  return (
    <CopilotChatMessageView
      {...props}
      userMessage={XiaozeUserMessage as typeof CopilotChatUserMessage}
      reasoningMessage={XiaozeReasoningMessage as unknown as typeof CopilotChatReasoningMessage}
      assistantMessage={XiaozeAssistantMessage as unknown as typeof CopilotChatAssistantMessage}
    >
      {({ messages, interruptElement, isRunning }) => {
        const showWelcome = shouldShowXiaozeWelcomePanel(messages.length);
        const showThinkingFallback = shouldShowXiaozeThinkingFallback(messages, isRunning);
        return (
          <div className="xiaoze-message-view" data-empty={showWelcome ? "true" : "false"}>
            {showWelcome ? <XiaozeWelcomePanel /> : null}
            {renderXiaozeTurnBlocks(messages, isRunning)}
            {showThinkingFallback ? <XiaozeThinkingIndicator /> : null}
            {interruptElement}
          </div>
        );
      }}
    </CopilotChatMessageView>
  );
}
