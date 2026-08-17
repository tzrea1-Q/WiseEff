import { ApiError, type ApiErrorCode } from "../../../shared/http/errors";

const CJK_PATTERN = /[\u4e00-\u9fff]/;

const REASON_COPY: Record<string, string> = {
  "stale-working-tip": "工作版本已过期，请刷新后基于最新版本重试。",
  "missing-overlay-target-ref": "无法解析要写入的 overlay 目标，请刷新后重试。",
  "mixed-working-tips": "当前存在多个工作版本，请刷新后重试。",
  "stale-revision": "配置修订已过期，请刷新后重试。"
};

const CODE_COPY: Partial<Record<ApiErrorCode, string>> = {
  CONFLICT: "操作与当前状态冲突，请刷新后重试。",
  VALIDATION_FAILED: "提交内容未通过校验，请检查后重试。",
  NOT_FOUND: "请求的内容不存在或已被移除。",
  INVALID_APPROVAL_STATE: "审批状态已变化，请刷新后重试。",
  DEVICE_UNAVAILABLE: "设备暂不可用，请检查连接后重试。",
  GONE: "请求的内容已失效。"
};

const FAILURE_PREFIX = "操作未能完成";
const GENERIC_REASON = "请刷新后重试。";

function reasonFromError(error: unknown): string {
  if (error instanceof ApiError) {
    const trimmed = error.message.trim();
    if (CJK_PATTERN.test(trimmed)) {
      return trimmed;
    }
    const reason = typeof error.details.reason === "string" ? error.details.reason : "";
    if (reason && REASON_COPY[reason]) {
      return REASON_COPY[reason];
    }
    return CODE_COPY[error.code] ?? GENERIC_REASON;
  }
  if (error instanceof Error && CJK_PATTERN.test(error.message)) {
    return error.message.trim();
  }
  return GENERIC_REASON;
}

/** Chinese assistant copy for an approved tool that failed during execution. */
export function formatApprovalExecutionFailure(error: unknown): string {
  const reason = reasonFromError(error);
  if (reason.startsWith(FAILURE_PREFIX)) {
    return reason;
  }
  return `${FAILURE_PREFIX}：${reason}`;
}
