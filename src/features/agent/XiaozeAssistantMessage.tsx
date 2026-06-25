import { useMemo, useRef, type ComponentProps } from "react";
import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";
import { XiaozeAssistantMarkdown } from "./XiaozeAssistantMarkdown";
import { stripEmbeddedThinkingForStream } from "./xiaozeMessageContent";
import { readRunStepsFromMetadata, XiaozeTurnTimeline } from "./XiaozeTurnTimeline";

type XiaozeAssistantMessageProps = ComponentProps<typeof CopilotChatAssistantMessage>;

function isLatestAssistantMessage(
  message: XiaozeAssistantMessageProps["message"],
  messages: XiaozeAssistantMessageProps["messages"]
) {
  return message.role === "assistant" && messages?.[messages.length - 1]?.id === message.id;
}

export function XiaozeAssistantMessage(props: XiaozeAssistantMessageProps) {
  const rawContent = typeof props.message.content === "string" ? props.message.content : props.message.content;
  const isStreaming = Boolean(props.isRunning && isLatestAssistantMessage(props.message, props.messages));
  const content =
    typeof rawContent === "string" ? stripEmbeddedThinkingForStream(rawContent) : rawContent;
  const metadata = (props.message as { metadata?: Record<string, unknown> }).metadata;
  const runSteps = readRunStepsFromMetadata(metadata);
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;
  const MarkdownRenderer = useMemo(() => {
    function Renderer(rendererProps: ComponentProps<typeof CopilotChatAssistantMessage.MarkdownRenderer>) {
      return (
        <XiaozeAssistantMarkdown
          content={rendererProps.content}
          className={rendererProps.className}
          isStreaming={isStreamingRef.current}
        />
      );
    }
    return Renderer;
  }, []);

  return (
    <article className="xiaoze-assistant-message-wrap">
      <div className="xiaoze-assistant-message__meta">
        <span className="xiaoze-assistant-message__name">小泽</span>
      </div>
      {!isStreaming && runSteps.length > 0 ? (
        <XiaozeTurnTimeline steps={runSteps} className="xiaoze-assistant-message__timeline" />
      ) : null}
      <CopilotChatAssistantMessage
        {...props}
        markdownRenderer={MarkdownRenderer}
        className={["xiaoze-assistant-message", props.className].filter(Boolean).join(" ")}
        message={{
          ...props.message,
          content
        }}
      />
    </article>
  );
}
