export function formatAuditRelativeTime(input: string) {
  const parsed = new Date(input).getTime();
  if (!Number.isFinite(parsed)) {
    return input;
  }

  const diffMs = Math.max(Date.now() - parsed, 0);
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${days} 天前`;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

export function formatAuditAbsoluteTime(input?: string) {
  if (!input) {
    return "—";
  }
  const parsed = new Date(input).getTime();
  if (!Number.isFinite(parsed)) {
    return input;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(parsed);
}
