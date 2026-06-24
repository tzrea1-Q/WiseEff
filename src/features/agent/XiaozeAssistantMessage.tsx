import type { ComponentProps } from "react";
import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";
import { stripEmbeddedThinking } from "./xiaozeMessageContent";

type XiaozeAssistantMessageProps = ComponentProps<typeof CopilotChatAssistantMessage>;

export function XiaozeAssistantMessage(props: XiaozeAssistantMessageProps) {
  const content = typeof props.message.content === "string" ? stripEmbeddedThinking(props.message.content) : props.message.content;

  return (
    <article className="xiaoze-assistant-message-wrap">
      <div className="xiaoze-assistant-message__meta">
        <span className="xiaoze-assistant-message__name">小泽</span>
      </div>
      <CopilotChatAssistantMessage
        {...props}
        className={["xiaoze-assistant-message", props.className].filter(Boolean).join(" ")}
        message={{
          ...props.message,
          content
        }}
      />
    </article>
  );
}
