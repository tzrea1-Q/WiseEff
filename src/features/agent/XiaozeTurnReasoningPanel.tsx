import { useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { xiaozeReasoningDevExpanded } from "@/infrastructure/http/runtimeMode";
import { useXiaozeRunTiming } from "./XiaozeRunTimingContext";

type XiaozeTurnReasoningPanelProps = {
  content: string;
  isStreaming: boolean;
  reasoningMessageId?: string;
  className?: string;
};

function formatDuration(seconds: number) {
  if (seconds < 1) {
    return "不到 1 秒";
  }
  if (seconds < 60) {
    return `${Math.round(seconds)} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder > 0 ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分`;
}

export function XiaozeTurnReasoningPanel({
  content,
  isStreaming,
  reasoningMessageId,
  className
}: XiaozeTurnReasoningPanelProps) {
  const hasContent = content.trim().length > 0;
  const runTiming = useXiaozeRunTiming(reasoningMessageId);
  const startTimeRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const userToggledRef = useRef(false);
  const [isOpen, setIsOpen] = useState(isStreaming || (xiaozeReasoningDevExpanded && hasContent));

  useEffect(() => {
    if (isStreaming && startTimeRef.current === null) {
      startTimeRef.current = Date.now();
    }
    if (!isStreaming && startTimeRef.current !== null) {
      setElapsed((Date.now() - startTimeRef.current) / 1000);
    }
    if (!isStreaming) {
      return;
    }
    const timer = setInterval(() => {
      if (startTimeRef.current !== null) {
        setElapsed((Date.now() - startTimeRef.current) / 1000);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isStreaming]);

  useEffect(() => {
    if (isStreaming) {
      userToggledRef.current = false;
      setIsOpen(true);
      return;
    }
    if (!userToggledRef.current) {
      setIsOpen(xiaozeReasoningDevExpanded && hasContent);
    }
  }, [hasContent, isStreaming]);

  if (!hasContent && !isStreaming) {
    return null;
  }

  const durationSeconds =
    !isStreaming && runTiming?.durationMs !== undefined ? runTiming.durationMs / 1000 : elapsed;
  const label = isStreaming ? "思考中…" : `已思考 ${formatDuration(durationSeconds)}`;

  return (
    <section
      className={[
        "xiaoze-reasoning-message",
        "xiaoze-turn-block__reasoning",
        isStreaming ? "is-streaming" : "",
        isOpen ? "is-open" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="xiaoze-reasoning-message__toggle"
        aria-expanded={isOpen}
        onClick={() => {
          userToggledRef.current = true;
          setIsOpen((open) => !open);
        }}
      >
        <span className="xiaoze-reasoning-message__icon" aria-hidden="true">
          <Sparkles size={14} />
        </span>
        <span className="xiaoze-reasoning-message__label">{label}</span>
        <ChevronDown
          size={16}
          className={isOpen ? "xiaoze-reasoning-message__chevron is-open" : "xiaoze-reasoning-message__chevron"}
        />
      </button>
      {isOpen && hasContent ? (
        <div className="xiaoze-reasoning-message__body-shell is-open">
          <div className="xiaoze-reasoning-message__body">{content}</div>
        </div>
      ) : null}
    </section>
  );
}
