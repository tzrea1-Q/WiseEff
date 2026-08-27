import { cloneElement, isValidElement, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { GripHorizontal, History, MessageSquarePlus, RotateCcw } from "lucide-react";
import { useAgent } from "@copilotkit/react-core/v2";
import { clearXiaozePromptDebugStore } from "./XiaozePromptDebugContext";
import { useXiaozeThreads } from "./XiaozeThreadContext";
import { writeXiaozePopupOpenSession } from "./xiaozePopupOpenState";
import { isXiaozePopupDesktop } from "./xiaozePopupLayout";
import { XiaozeThreadHistoryPanel } from "./XiaozeThreadHistoryPanel";

type XiaozeChatHeaderProps = {
  titleContent: ReactNode;
  closeButton: ReactNode;
  title?: string;
};

export function XiaozeChatHeader({ closeButton }: XiaozeChatHeaderProps) {
  const [isDesktop, setIsDesktop] = useState(() => isXiaozePopupDesktop());
  useEffect(() => {
    const handleResize = () => setIsDesktop(isXiaozePopupDesktop());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const resolvedCloseButton = isValidElement<{
    "aria-label"?: string;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
    title?: string;
  }>(closeButton)
    ? cloneElement(closeButton, {
        "aria-label": "关闭小泽",
        onClick: (event: MouseEvent<HTMLButtonElement>) => {
          writeXiaozePopupOpenSession(false);
          closeButton.props.onClick?.(event);
        },
        title: "关闭小泽"
      })
    : closeButton;
  const { agent } = useAgent({ agentId: "default" });
  const {
    activeThreadId,
    historyOpen,
    setHistoryOpen,
    createNewThread,
    selectThread,
    deleteThread
  } = useXiaozeThreads();

  const handleToggleHistory = () => {
    setHistoryOpen(!historyOpen);
  };

  const handleCreateNewThread = () => {
    createNewThread(agent.messages);
    clearXiaozePromptDebugStore();
  };

  const handleSelectThread = (threadId: string) => {
    selectThread(threadId, agent.messages);
    clearXiaozePromptDebugStore();
  };

  const handleDeleteThread = (threadId: string) => {
    void deleteThread(threadId, agent.messages);
    clearXiaozePromptDebugStore();
  };

  return (
    <div className="xiaoze-chat-header-shell">
      <header className="xiaoze-chat-header" data-testid="xiaoze-chat-header">
        <div className="xiaoze-chat-header__actions xiaoze-chat-header__actions--start">
          <button
            type="button"
            className={`xiaoze-chat-header__button${historyOpen ? " is-active" : ""}`}
            aria-expanded={historyOpen}
            aria-controls="xiaoze-thread-history-panel"
            onClick={handleToggleHistory}
          >
            <History aria-hidden="true" size={15} />
            <span>历史</span>
          </button>
          <button type="button" className="xiaoze-chat-header__button xiaoze-chat-header__button--primary" onClick={handleCreateNewThread}>
            <MessageSquarePlus aria-hidden="true" size={15} />
            <span>新对话</span>
          </button>
        </div>
        {isDesktop ? (
          <>
            <button
              type="button"
              className="xiaoze-chat-header__brand xiaoze-chat-header__drag-handle"
              data-xiaoze-drag-handle=""
              aria-label="拖动小泽窗口"
              aria-describedby="xiaoze-drag-handle-instructions"
              title="拖动小泽窗口；方向键微调，Shift 加速，Home 复位"
            >
              <GripHorizontal aria-hidden="true" size={15} />
              <strong className="xiaoze-chat-header__title">小泽</strong>
            </button>
            <span id="xiaoze-drag-handle-instructions" className="sr-only">
              使用鼠标或触屏拖动；方向键每次移动 8 像素，按住 Shift 每次移动 32 像素，Home 恢复默认位置。
            </span>
          </>
        ) : (
          <div className="xiaoze-chat-header__brand xiaoze-chat-header__mobile-brand" data-xiaoze-mobile-brand="">
            <strong className="xiaoze-chat-header__title">小泽</strong>
          </div>
        )}
        <div className="xiaoze-chat-header__actions xiaoze-chat-header__actions--end">
          <button
            type="button"
            className="xiaoze-chat-header__button xiaoze-chat-header__reset"
            data-xiaoze-layout-reset=""
            aria-label="恢复小泽默认位置和大小"
            title="恢复默认位置和大小"
            hidden
          >
            <RotateCcw aria-hidden="true" size={15} />
            <span className="sr-only">恢复默认位置和大小</span>
          </button>
          {resolvedCloseButton}
        </div>
      </header>
      <div className={`xiaoze-thread-history-shell${historyOpen ? " is-open" : ""}`} aria-hidden={!historyOpen}>
        <XiaozeThreadHistoryPanel
          activeThreadId={activeThreadId}
          onSelectThread={handleSelectThread}
          onDeleteThread={handleDeleteThread}
        />
      </div>
    </div>
  );
}
