import type { ReactNode } from "react";
import { History, MessageSquarePlus } from "lucide-react";
import { useAgent } from "@copilotkit/react-core/v2";
import { clearXiaozePromptDebugStore } from "./XiaozePromptDebugContext";
import { useXiaozeThreads } from "./XiaozeThreadContext";
import { XiaozeThreadHistoryPanel } from "./XiaozeThreadHistoryPanel";

type XiaozeChatHeaderProps = {
  titleContent: ReactNode;
  closeButton: ReactNode;
  title?: string;
};

export function XiaozeChatHeader({ closeButton }: XiaozeChatHeaderProps) {
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
        <div className="xiaoze-chat-header__brand">
          <strong className="xiaoze-chat-header__title">小泽</strong>
        </div>
        <div className="xiaoze-chat-header__actions xiaoze-chat-header__actions--end">{closeButton}</div>
      </header>
      {historyOpen ? (
        <XiaozeThreadHistoryPanel
          activeThreadId={activeThreadId}
          onSelectThread={handleSelectThread}
          onDeleteThread={handleDeleteThread}
        />
      ) : null}
    </div>
  );
}
