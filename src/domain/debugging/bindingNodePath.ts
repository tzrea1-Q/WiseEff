import { WiseEffApiError } from "@/infrastructure/http/apiClient";

const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

export function normalizeBindingNodePath(nodePath: string): string {
  return nodePath.trim();
}

export function getBindingNodePathValidationError(nodePath: string): string | null {
  const normalized = normalizeBindingNodePath(nodePath);
  if (!normalized) {
    return "节点路径不能为空。";
  }
  if (!normalized.startsWith("/")) {
    return "节点路径必须以 / 开头。";
  }
  if (CONTROL_CHAR_PATTERN.test(normalized)) {
    return "节点路径不能包含控制字符。";
  }
  return null;
}

export function formatDebugAdminBindingSaveError(error: unknown, fallback = "保存路径绑定失败。"): string {
  const pathError = extractBindingNodePathApiError(error);
  if (pathError) {
    return pathError;
  }
  if (error instanceof WiseEffApiError && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function extractBindingNodePathApiError(error: unknown): string | null {
  if (!(error instanceof WiseEffApiError) || error.code !== "VALIDATION_FAILED") {
    return null;
  }

  const issues = error.details.issues;
  if (!Array.isArray(issues)) {
    return "路径绑定校验失败，请检查节点路径是否以 / 开头且不为空。";
  }

  const nodePathIssue = issues.find((issue) => {
    if (!issue || typeof issue !== "object") {
      return false;
    }
    const path = (issue as { path?: unknown }).path;
    return Array.isArray(path) && path.includes("nodePath");
  }) as { message?: string } | undefined;

  if (nodePathIssue?.message?.includes('start with "/"') || nodePathIssue?.message?.includes("at least 1 character")) {
    return "节点路径必须以 / 开头且不能为空。";
  }

  if (nodePathIssue?.message) {
    return `节点路径无效：${nodePathIssue.message}`;
  }

  return "路径绑定校验失败，请检查节点路径是否以 / 开头且不为空。";
}
