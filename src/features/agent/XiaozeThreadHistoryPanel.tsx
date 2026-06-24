import { useMemo } from "react";
import { Clock3, MessagesSquare, Trash2 } from "lucide-react";
import { useXiaozeThreads } from "./XiaozeThreadContext";

type XiaozeThreadHistoryPanelProps = {
  activeThreadId: string;
  onSelectThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
};

function formatThreadTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function XiaozeThreadHistoryPanel({ activeThreadId, onSelectThread, onDeleteThread }: XiaozeThreadHistoryPanelProps) {
  const { threads } = useXiaozeThreads();
  const sortedThreads = useMemo(
    () => [...threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [threads]
  );

  return (
    <section
      id="xiaoze-thread-history-panel"
      className="xiaoze-thread-history"
      aria-label="历史对话"
      data-testid="xiaoze-thread-history-panel"
    >
      <div className="xiaoze-thread-history__header">
        <div className="xiaoze-thread-history__heading">
          <MessagesSquare size={15} aria-hidden="true" />
          <span>最近对话</span>
        </div>
        <span className="xiaoze-thread-history__count">{sortedThreads.length}</span>
      </div>
      {sortedThreads.length === 0 ? (
        <p className="xiaoze-thread-history__empty">暂无历史对话，开始第一次提问吧。</p>
      ) : (
        <ul className="xiaoze-thread-history__list">
          {sortedThreads.map((thread) => {
            const isActive = thread.id === activeThreadId;
            return (
              <li key={thread.id} className="xiaoze-thread-history__row">
                <button
                  type="button"
                  className={`xiaoze-thread-history__item${isActive ? " is-active" : ""}`}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => onSelectThread(thread.id)}
                >
                  <span className="xiaoze-thread-history__item-main">
                    <span className="xiaoze-thread-history__title">{thread.title}</span>
                    <span className="xiaoze-thread-history__preview">{thread.preview}</span>
                  </span>
                  <span className="xiaoze-thread-history__time">
                    <Clock3 size={12} aria-hidden="true" />
                    {formatThreadTime(thread.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  className="xiaoze-thread-history__delete"
                  aria-label={`删除对话：${thread.title}`}
                  data-testid={`xiaoze-thread-delete-${thread.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteThread(thread.id);
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
