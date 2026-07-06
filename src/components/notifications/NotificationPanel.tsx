import type { NotificationItem } from "@/domain/notifications/types";

function formatRelativeTime(iso: string) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const deltaMs = Date.now() - timestamp;
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

type NotificationPanelProps = {
  items: NotificationItem[];
  loading: boolean;
  error: string;
  onClose: () => void;
  onRetry: () => void;
  onMarkAllRead: () => void;
  onOpenItem: (item: NotificationItem) => void;
};

export function NotificationPanel({
  items,
  loading,
  error,
  onClose,
  onRetry,
  onMarkAllRead,
  onOpenItem
}: NotificationPanelProps) {
  const hasUnread = items.some((item) => !item.readAt);

  return (
    <>
      <button aria-label="关闭通知面板" className="topbar-notification__backdrop" type="button" onClick={onClose} />
      <section aria-label="通知面板" className="topbar-notification__panel" role="dialog">
        <header className="topbar-notification__header">
          <strong>通知</strong>
          <div className="topbar-notification__header-actions">
            {hasUnread ? (
              <button className="link-button" type="button" onClick={() => void onMarkAllRead()}>
                全部标为已读
              </button>
            ) : null}
            <button className="link-button" type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>

        {loading ? <p className="topbar-notification__status">加载中...</p> : null}
        {error ? (
          <div className="topbar-notification__status topbar-notification__status--error">
            <p>{error}</p>
            <button className="button subtle" type="button" onClick={onRetry}>
              重试
            </button>
          </div>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <p className="topbar-notification__empty">暂无通知</p>
        ) : null}

        {!loading && !error && items.length > 0 ? (
          <ul className="topbar-notification__list">
            {items.map((item) => {
              const unread = !item.readAt;
              return (
                <li key={item.id}>
                  <button
                    className={unread ? "topbar-notification__item topbar-notification__item--unread" : "topbar-notification__item"}
                    type="button"
                    onClick={() => onOpenItem(item)}
                  >
                    <span className="topbar-notification__item-title">{item.title}</span>
                    <span className="topbar-notification__item-body">{item.body}</span>
                    <span className="topbar-notification__item-meta">{formatRelativeTime(item.createdAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </>
  );
}
