import { Streamdown } from "streamdown";
import { stripEmbeddedThinking, stripEmbeddedThinkingForStream } from "./xiaozeMessageContent";
import { xiaozeStreamdownComponents } from "./xiaozeStreamdownComponents";
import "./xiaozeAssistantMarkdown.css";

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
    <div className={["xiaoze-assistant-markdown", isStreaming ? "xiaoze-streaming-markdown" : undefined].filter(Boolean).join(" ")}>
      <Streamdown
        mode={isStreaming ? "streaming" : "static"}
        parseIncompleteMarkdown={isStreaming}
        isAnimating={isStreaming}
        components={xiaozeStreamdownComponents}
        controls={{ table: false, code: false, mermaid: false }}
        className={["copilotKitMarkdown", "xiaoze-md-root", className].filter(Boolean).join(" ")}
      >
        {displayContent}
      </Streamdown>
      {isStreaming ? <span className="xiaoze-streaming-markdown__cursor" aria-hidden="true" /> : null}
    </div>
  );
}
