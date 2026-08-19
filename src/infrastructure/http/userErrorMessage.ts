import { WiseEffApiError } from "@/infrastructure/http/apiClient";

/**
 * Chinese user-facing copy per server error code (`server/shared/http/errors.ts`).
 * The server `message` field is English operator prose and must not surface in
 * product toasts verbatim; the request id keeps failures reportable.
 */
const CODE_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "登录状态已失效，请重新登录。",
  FORBIDDEN: "当前角色没有执行该操作的权限。",
  NOT_FOUND: "目标数据不存在或已被删除，请刷新后重试。",
  VALIDATION_FAILED: "提交内容未通过校验，请检查后重试。",
  CONFLICT: "数据已被其他人修改，请刷新后基于最新状态重试。",
  APPROVAL_REQUIRED: "该操作需要审批通过后才能执行。",
  INVALID_APPROVAL_STATE: "审批状态已变化，无法执行该操作，请刷新查看最新审批状态。",
  DEVICE_UNAVAILABLE: "设备当前不可用或被其他会话占用，请稍后重试。",
  PROTOCOL_UNSUPPORTED: "目标设备不支持该调试协议。",
  DEBUG_BINDING_NOT_CONFIGURED: "该参数尚未配置调试节点绑定，无法执行设备操作。",
  DEBUG_BINDING_DISABLED: "该参数的调试节点绑定已被停用。",
  GONE: "目标资源已过期或被回收，请刷新后重试。",
  RATE_LIMITED: "尝试次数过多，请稍后再试。",
  INTERNAL_ERROR: "服务内部错误，请稍后重试。"
};

/** Known machine-readable `details.reason` values that deserve sharper copy than their code. */
const REASON_MESSAGES: Record<string, string> = {
  "schema-failure": "内容不符合参数结构要求，请核对格式。",
  "gate-token-expired": "发布门凭据已过期，页面数据可能已陈旧，请刷新后重新发起。"
};

function requestIdSuffix(requestId: string): string {
  if (!requestId) {
    return "";
  }
  return `（请求编号 ${requestId.slice(0, 8)}）`;
}

/**
 * Map any thrown value to Chinese user-facing copy.
 *
 * - `WiseEffApiError`: Chinese sentence per code (or per known `details.reason`),
 *   suffixed with a short request id for support escalation.
 * - Network-level fetch failures: connectivity copy.
 * - Anything else: the provided fallback, then the error's own message.
 */
export function toUserErrorMessage(error: unknown, fallback = "操作失败，请稍后重试。"): string {
  if (error instanceof WiseEffApiError) {
    const reason = typeof error.details.reason === "string" ? error.details.reason : "";
    const base = REASON_MESSAGES[reason] ?? CODE_MESSAGES[error.code];
    if (base) {
      return `${base}${requestIdSuffix(error.requestId)}`;
    }
    // Unknown code: keep the server text (better than a lie) but stay reportable.
    return `${error.message}${requestIdSuffix(error.requestId)}`;
  }
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return "无法连接服务器，请检查网络或稍后重试。";
  }
  // Plain errors: only Chinese messages are user-facing copy (runtimes wrap
  // localized blocker text in Error); ASCII technical prose stays internal.
  if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)) {
    return error.message;
  }
  return fallback;
}
