export type DebuggingAdminArea = "parameter" | "nodes";

export const DEBUGGING_ADMIN_PATH = "/debugging-admin";
export const DEBUGGING_ADMIN_NODES_PATH = "/debugging-admin/nodes";

export const DEBUGGING_ADMIN_UI = {
  scopeNavAria: "调试后台范围",
  parameterScope: "参数调试",
  nodesScope: "节点调试",
  parameterSubtitle: "重载配置：落地路径、触发节点与内核日志命令",
  nodesSubtitle: "可调节点目录、协议绑定与模块管理"
} as const;

export function isDebuggingAdminPath(path: string): boolean {
  return path === DEBUGGING_ADMIN_PATH || path === DEBUGGING_ADMIN_NODES_PATH || path.startsWith(`${DEBUGGING_ADMIN_PATH}/`);
}

export function parseDebuggingAdminArea(path: string): DebuggingAdminArea | null {
  if (path === DEBUGGING_ADMIN_NODES_PATH || path.startsWith(`${DEBUGGING_ADMIN_NODES_PATH}/`)) {
    return "nodes";
  }
  if (path === DEBUGGING_ADMIN_PATH || path.startsWith(`${DEBUGGING_ADMIN_PATH}/`)) {
    return "parameter";
  }
  return null;
}

export function buildDebuggingAdminPath(area: DebuggingAdminArea): string {
  return area === "nodes" ? DEBUGGING_ADMIN_NODES_PATH : DEBUGGING_ADMIN_PATH;
}
