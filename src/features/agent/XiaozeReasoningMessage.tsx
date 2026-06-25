import { useEffect, useRef, useState } from "react";
import type { Message, ReasoningMessage } from "@ag-ui/core";
import { ChevronDown, Sparkles } from "lucide-react";
import { xiaozeReasoningDevExpanded } from "@/infrastructure/http/runtimeMode";
import { isXiaozeReasoningStreaming } from "./xiaozeThinkingState";
import { useXiaozeRunTiming } from "./XiaozeRunTimingContext";

type XiaozeReasoningMessageProps = {
  message: ReasoningMessage;
  messages?: Message[];
  isRunning?: boolean;
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

export function XiaozeReasoningMessage({ message, messages, isRunning, className }: XiaozeReasoningMessageProps) {
  const isStreaming = isXiaozeReasoningStreaming(message, messages, isRunning);
  const serverTiming = useXiaozeRunTiming(message.id);
  const hasContent = !!(message.content && message.content.length > 0);
  const startTimeRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const userToggledRef = useRef(false);
  const [isOpen, setIsOpen] = useState(isStreaming || (xiaozeReasoningDevExpanded && hasContent));

  useEffect(() => {
    if (serverTiming) {
      return;
    }
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
  }, [isStreaming, serverTiming]);

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

  const completedSeconds = serverTiming ? serverTiming.durationMs / 1000 : elapsed;
  const label = isStreaming ? "思考中…" : `已思考 ${formatDuration(completedSeconds)}`;

  return (
    <section
      className={[
        "xiaoze-reasoning-message",
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
        <ChevronDown size={16} className={isOpen ? "xiaoze-reasoning-message__chevron is-open" : "xiaoze-reasoning-message__chevron"} />
      </button>
      {isOpen ? <div className="xiaoze-reasoning-message__body">{message.content}</div> : null}
    </section>
  );
}
