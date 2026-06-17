import type { ParameterSubmissionRound } from "./types";

const terminalSubmissionRoundStatuses = new Set<ParameterSubmissionRound["status"]>([
  "已合入",
  "已打回",
  "已撤回",
  "已暂存"
]);

export function canWithdrawSubmissionRound(status: ParameterSubmissionRound["status"]): boolean {
  return !terminalSubmissionRoundStatuses.has(status);
}

export function isActiveSubmissionRound(status: ParameterSubmissionRound["status"]): boolean {
  return canWithdrawSubmissionRound(status);
}

export function formatSubmissionTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
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
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(parsed));
}
