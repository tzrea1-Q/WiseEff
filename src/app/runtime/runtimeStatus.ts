import type { PageKey } from "@/appConfig";

export type RuntimeDomain = "auth" | "parameters" | "logs" | "debugging" | "users";

export type RuntimeDomainStatus =
  | { state: "idle" | "loading" }
  | { state: "ready"; loadedAt: string }
  | { state: "unavailable"; message: string; retryKey: number };

export type ApiRuntimeStatus = Record<RuntimeDomain, RuntimeDomainStatus>;

export type BlockingRuntimeStatus = {
  domain: RuntimeDomain;
  status: Exclude<RuntimeDomainStatus, { state: "idle" | "ready" }>;
};

const runtimeDomains: RuntimeDomain[] = ["auth", "parameters", "logs", "debugging", "users"];

const domainLabels: Record<RuntimeDomain, string> = {
  auth: "雷泽 API",
  parameters: "参数 API",
  logs: "日志 API",
  debugging: "调试 API",
  users: "用户 API"
};

const defaultUnavailableMessages: Record<RuntimeDomain, string> = {
  auth: "无法连接雷泽 API。请检查网络、认证或服务状态后重试。",
  parameters: "参数 API 暂不可用。请稍后重试。",
  logs: "日志 API 暂不可用。请稍后重试。",
  debugging: "调试 API 暂不可用。请稍后重试。",
  users: "用户 API 暂不可用。请稍后重试。"
};

export function createInitialApiRuntimeStatus(initialState: "idle" | "loading" = "loading"): ApiRuntimeStatus {
  return Object.fromEntries(runtimeDomains.map((domain) => [domain, { state: initialState }])) as ApiRuntimeStatus;
}

function nextRetryKey(current: RuntimeDomainStatus): number {
  return current.state === "unavailable" ? current.retryKey + 1 : 1;
}

export function markRuntimeDomainLoading(status: ApiRuntimeStatus, domain: RuntimeDomain): ApiRuntimeStatus {
  return {
    ...status,
    [domain]: { state: "loading" }
  };
}

export function markRuntimeDomainReady(status: ApiRuntimeStatus, domain: RuntimeDomain, loadedAt = new Date().toISOString()): ApiRuntimeStatus {
  return {
    ...status,
    [domain]: { state: "ready", loadedAt }
  };
}

export function markRuntimeDomainUnavailable(
  status: ApiRuntimeStatus,
  domain: RuntimeDomain,
  message = defaultUnavailableMessages[domain]
): ApiRuntimeStatus {
  return {
    ...status,
    [domain]: {
      state: "unavailable",
      message,
      retryKey: nextRetryKey(status[domain])
    }
  };
}

export function resetRuntimeDomainForRetry(status: ApiRuntimeStatus, domain: RuntimeDomain): ApiRuntimeStatus {
  return markRuntimeDomainLoading(status, domain);
}

export function requiredDomainsForPage(pageKey: PageKey): RuntimeDomain[] {
  switch (pageKey) {
    case "parameters":
    case "parameter-submissions":
    case "parameter-comparison":
    case "parameter-review":
    case "parameter-admin":
    case "parameter-home":
      return ["auth", "parameters", "users"];
    case "logs":
    case "log-admin":
    case "log-dashboard":
      return ["auth", "logs"];
    case "debugging":
    case "node-debugging":
    case "debugging-admin":
      return ["auth", "debugging"];
    case "user-permissions":
      return ["auth", "users"];
    default:
      return ["auth"];
  }
}

export function selectBlockingRuntimeStatus(pageKey: PageKey, status: ApiRuntimeStatus): BlockingRuntimeStatus | null {
  for (const domain of requiredDomainsForPage(pageKey)) {
    const domainStatus = status[domain];
    if (domainStatus.state === "loading" || domainStatus.state === "unavailable") {
      return { domain, status: domainStatus };
    }
  }

  return null;
}

export function runtimeDomainLabel(domain: RuntimeDomain): string {
  return domainLabels[domain];
}

export function runtimeUnavailableMessage(domain: RuntimeDomain): string {
  return defaultUnavailableMessages[domain];
}
