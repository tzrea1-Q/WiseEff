import { useState, type MouseEvent } from "react";
import { Check, ChevronDown, Code2, Copy } from "lucide-react";
import type { XiaozePromptDebugSnapshot } from "./xiaozePromptDebugTypes";
import { formatLlmMessageBody, formatLlmMessageRole, formatPromptDebugCopyText } from "./xiaozePromptDebugFormat";

type XiaozePromptDebugPanelProps = {
  snapshot: XiaozePromptDebugSnapshot;
};

function DebugSection({ title, children }: { title: string; children: string }) {
  return (
    <section className="xiaoze-prompt-debug__section">
      <h4 className="xiaoze-prompt-debug__section-title">{title}</h4>
      <pre className="xiaoze-prompt-debug__pre">{children}</pre>
    </section>
  );
}

function LlmMessageTrace({ messages }: { messages: unknown[] }) {
  if (messages.length === 0) {
    return <DebugSection title="LLM 交互 (0 条)" children="(empty)" />;
  }

  return (
    <section className="xiaoze-prompt-debug__section">
      <h4 className="xiaoze-prompt-debug__section-title">LLM 交互 ({messages.length} 条)</h4>
      <ol className="xiaoze-prompt-debug__trace">
        {messages.map((message, index) => {
          const role = formatLlmMessageRole(message);
          const body = formatLlmMessageBody(message);
          return (
            <li key={`${index}-${role}`} className="xiaoze-prompt-debug__trace-item">
              <div className="xiaoze-prompt-debug__trace-header">
                <span className="xiaoze-prompt-debug__trace-index">#{index + 1}</span>
                <span className="xiaoze-prompt-debug__trace-role">{role}</span>
              </div>
              <pre className="xiaoze-prompt-debug__pre">{body || "(empty)"}</pre>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function XiaozePromptDebugPanel({ snapshot }: XiaozePromptDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const text = formatPromptDebugCopyText(snapshot);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="xiaoze-prompt-debug">
      <div className="xiaoze-prompt-debug__header">
        <button
          type="button"
          className="xiaoze-prompt-debug__toggle"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
        >
          <span className="xiaoze-prompt-debug__icon" aria-hidden="true">
            <Code2 size={14} />
          </span>
          <span className="xiaoze-prompt-debug__label">完整提示词</span>
          <ChevronDown size={16} className={isOpen ? "xiaoze-prompt-debug__chevron is-open" : "xiaoze-prompt-debug__chevron"} />
        </button>
        <button
          type="button"
          className="xiaoze-prompt-debug__copy"
          aria-label={copied ? "已复制完整提示词" : "复制完整提示词"}
          title={copied ? "已复制" : "复制完整提示词"}
          onClick={(event) => void handleCopy(event)}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      {isOpen ? (
        <div className="xiaoze-prompt-debug__body">
          {snapshot.model ? <DebugSection title="Model" children={snapshot.model} /> : null}
          <DebugSection title="User message" children={snapshot.userMessage} />
          <DebugSection title="Page context" children={JSON.stringify(snapshot.context, null, 2)} />
          <DebugSection title="System policy" children={snapshot.system.policy} />
          <DebugSection title="Tool catalog" children={snapshot.system.toolCatalog} />
          <DebugSection title="Tool definitions" children={JSON.stringify(snapshot.tools, null, 2)} />
          <LlmMessageTrace messages={snapshot.llmMessages} />
        </div>
      ) : null}
    </section>
  );
}
