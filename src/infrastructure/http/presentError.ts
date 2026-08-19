import { WiseEffApiError } from "./apiClient";

/**
 * Error-presentation layer mandated by the design system (§Content and
 * Language): user-visible surfaces never render raw `error.message`, slugs,
 * or English backend text. Callers pass a scenario-specific Chinese fallback;
 * this module upgrades known structured errors to product copy.
 */

const CJK_PATTERN = /[\u4e00-\u9fff]/;

/** Known backend English messages that deserve specific product copy. */
const MESSAGE_LABELS: Array<{ match: RegExp; label: string | ((match: RegExpMatchArray) => string) }> = [
  { match: /^Unsupported (log format|file extension)/i, label: "暂不支持该日志格式，请上传 .log / .txt / .csv / .json 文本日志。" },
  {
    match: /^DTS import source exceeds the (\d+) byte limit\.?$/i,
    label: (match) => `DTS 源超出 ${match[1]} 字节大小上限，请精简后重试。`
  },
  { match: /^Log analysis failed before a report was generated\.?$/i, label: "分析未完成，未生成报告，请重试或重新上传。" },
  { match: /^Username or password is incorrect\.?$/i, label: "用户名或密码不正确。" },
  { match: /^Current password is incorrect\.?$/i, label: "当前密码不正确。" },
  { match: /^New password must be different from the current password\.?$/i, label: "新密码不能与当前密码相同。" },
  { match: /^Too many authentication attempts\. Try again later\.?$/i, label: "尝试次数过多，请稍后再试。" },
  { match: /^Self-registration is disabled\.?$/i, label: "当前环境已关闭自助注册，请联系管理员创建账号。" },
  { match: /^Local password credential was not found\.?$/i, label: "该账号没有本地密码凭据。" },
  { match: /^User is pending Admin approval\.?$/i, label: "账号等待管理员批准后才能登录。" },
  { match: /^User is inactive\.?$/i, label: "账号已被停用，请联系管理员。" },
  { match: /^Username is already registered\.?$/i, label: "该用户名已被注册。" },
  { match: /^Username must be 3 to 64 characters\.?$/i, label: "用户名须为 3–64 个字符，仅限字母、数字、点、下划线和连字符。" },
  { match: /^Username can only contain letters, numbers, dots, underscores, or hyphens\.?$/i, label: "用户名须为 3–64 个字符，仅限字母、数字、点、下划线和连字符。" },
  { match: /^Password must be at least 8 characters\.?$/i, label: "密码至少需要 8 个字符。" },
  { match: /^Session is not active\.?$/i, label: "登录状态已失效，请重新登录。" },
  { match: /^Token has expired\.?$/i, label: "登录状态已过期，请重新登录。" },
  { match: /^Release readiness could not load open conflicts\.?$/i, label: "发布就绪检查暂时不可用：冲突清单加载失败。" },
  { match: /^Release readiness could not load config set members\.?$/i, label: "发布就绪检查暂时不可用：配置集成员加载失败。" },
  { match: /^Release readiness could not load pending change requests\.?$/i, label: "发布就绪检查暂时不可用：待处理变更加载失败。" },
  { match: /^Release readiness gate token is required\.?$/i, label: "发布门禁令牌缺失，请重新评估发布就绪。" },
  { match: /^Release readiness gate token is stale\.?$/i, label: "发布门禁令牌已过期，请重新评估发布就绪。" },
  { match: /^Release readiness is unavailable\.?$/i, label: "发布就绪检查暂时不可用。" },
  {
    match: /^Base config revision is stale for this binding\.?$/i,
    label: "配置修订已过期，请刷新拓扑后基于最新修订重试。"
  },
  { match: /^Schema validation failed\.?$/i, label: "提交内容未通过校验，请检查后重试。" }
];

/** Generic product copy per structured API error code (used when the message has no specific mapping). */
const CODE_LABELS: Record<string, string> = {
  UNAUTHENTICATED: "认证未通过，请重新登录。",
  FORBIDDEN: "没有权限执行该操作。",
  NOT_FOUND: "请求的内容不存在或已被移除。",
  CONFLICT: "操作与当前状态冲突，请刷新后重试。",
  VALIDATION_FAILED: "提交内容未通过校验，请检查后重试。",
  APPROVAL_REQUIRED: "该操作需要审批通过后才能执行。",
  INVALID_APPROVAL_STATE: "审批状态已变化，请刷新后重试。",
  DEVICE_UNAVAILABLE: "设备暂不可用，请检查连接后重试。",
  DEBUG_BINDING_DISABLED: "该调试绑定已停用。",
  DEBUG_BINDING_NOT_CONFIGURED: "该调试绑定尚未配置。",
  PROTOCOL_UNSUPPORTED: "当前协议不支持该操作。",
  GONE: "请求的内容已失效。",
  RATE_LIMITED: "尝试次数过多，请稍后再试。"
};

const NETWORK_MESSAGE_PATTERN = /failed to fetch|networkerror|network error|load failed|fetch failed/i;

export const NETWORK_ERROR_MESSAGE = "网络连接失败，请稍后重试。";

function semanticEditSuccessorCopy(err: WiseEffApiError): string | null {
  if (err.code !== "CONFLICT") return null;
  if (err.details.code !== "semantic-edit-requires-successor" && err.details.reason !== "semantic-edit-requires-successor") {
    return null;
  }
  return "语义字段（取值形状 / 约束 / 单位）不能在已启用或已废弃定义上直接修改，请通过激活后继版本完成切换。";
}

function identityCollisionCopy(err: WiseEffApiError): string | null {
  if (err.code !== "CONFLICT") return null;
  const specId = err.details.parameterSpecId;
  if (typeof specId !== "string" || !specId.trim()) return null;
  if (!("lifecycle" in err.details)) return null;
  const raw = typeof err.details.lifecycle === "string" ? err.details.lifecycle.trim() : "";
  const lifecycleLabel =
    raw === "draft"
      ? "草稿"
      : raw === "active"
        ? "已启用"
        : raw === "deprecated"
          ? "已废弃"
          : raw || "未知";
  return `目标身份已被定义「${specId}」（${lifecycleLabel}）占用，无法覆盖。`;
}

/**
 * Fetch-level network failure (service unreachable, DNS, offline). Structured
 * API errors — including 401/403 — are `WiseEffApiError`, never a `TypeError`.
 */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && NETWORK_MESSAGE_PATTERN.test(err.message);
}

/**
 * Map a raw message string (e.g. a backend `failureReason` already detached
 * from its Error) to product copy. Chinese messages pass through; known
 * English messages map to product copy; anything else falls back.
 */
export function presentErrorMessage(message: string | null | undefined, fallback: string): string {
  const trimmed = message?.trim();
  if (!trimmed) {
    return fallback;
  }
  if (CJK_PATTERN.test(trimmed)) {
    return trimmed;
  }
  for (const entry of MESSAGE_LABELS) {
    const match = trimmed.match(entry.match);
    if (match) {
      return typeof entry.label === "function" ? entry.label(match) : entry.label;
    }
  }
  return fallback;
}

/**
 * Present any thrown value as product-language copy. Never returns raw
 * `err.message` unless it is already Chinese product copy.
 */
export function presentError(err: unknown, fallback: string): string {
  if (isNetworkError(err)) {
    return NETWORK_ERROR_MESSAGE;
  }

  if (err instanceof WiseEffApiError) {
    const semanticEdit = semanticEditSuccessorCopy(err);
    if (semanticEdit) {
      return semanticEdit;
    }
    const collision = identityCollisionCopy(err);
    if (collision) {
      return collision;
    }
    const byMessage = presentErrorMessage(err.message, "");
    if (byMessage) {
      return byMessage;
    }
    return CODE_LABELS[err.code] ?? fallback;
  }

  if (err instanceof Error) {
    return presentErrorMessage(err.message, fallback);
  }

  return fallback;
}
