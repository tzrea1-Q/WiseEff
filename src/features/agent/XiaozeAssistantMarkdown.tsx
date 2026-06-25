import { Streamdown } from "streamdown";
import { stripEmbeddedThinking, stripEmbeddedThinkingForStream } from "./xiaozeMessageContent";

type XiaozeAssistantMarkdownProps = {
  content?: string;
  className?: string;
  isStreaming?: boolean;
};

export function XiaozeAssistantMarkdown({ content = "", className, isStreaming = false }: XiaozeAssistantMarkdownProps) {
  const displayContent = isStreaming ? stripEmbeddedThinkingForStream(content) : stripEmbeddedThinking(content);

  if (!displayContent.trim()) {
    return null;
  }

  return (
    <div className={isStreaming ? "xiaoze-streaming-markdown" : undefined}>
      <Streamdown
        mode={isStreaming ? "streaming" : "static"}
        parseIncompleteMarkdown={isStreaming}
        isAnimating={isStreaming}
        className={["copilotKitMarkdown", className].filter(Boolean).join(" ")}
      >
        {displayContent}
      </Streamdown>
      {isStreaming ? <span className="xiaoze-streaming-markdown__cursor" aria-hidden="true" /> : null}
    </div>
  );
}
