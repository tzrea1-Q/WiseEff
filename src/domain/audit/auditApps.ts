export type AuditAppGroupId = "all" | "parameter" | "logs" | "debugging" | "agent" | "users";

export type AuditAppGroup = {
  id: AuditAppGroupId;
  label: string;
  apiApps: string[];
  mockApps: string[];
};

export const auditAppGroups: AuditAppGroup[] = [
  { id: "all", label: "全部模块", apiApps: [], mockApps: [] },
  {
    id: "parameter",
    label: "参数管理",
    apiApps: ["parameter-management", "parameter-admin"],
    mockApps: ["parameter-management", "parameter-admin", "parameters", "parameter-review", "parameter-submissions"]
  },
  {
    id: "logs",
    label: "日志分析",
    apiApps: ["log-analysis"],
    mockApps: ["log-analysis", "logs", "log-admin"]
  },
  {
    id: "debugging",
    label: "调试平台",
    apiApps: ["debugging"],
    mockApps: ["debugging", "debugging-admin", "node-debugging"]
  },
  { id: "agent", label: "Agent", apiApps: ["agent"], mockApps: ["agent"] },
  {
    id: "users",
    label: "用户治理",
    apiApps: ["user-governance"],
    mockApps: ["user-governance", "user-permissions"]
  }
];

export function getAuditAppGroup(id: AuditAppGroupId) {
  return auditAppGroups.find((group) => group.id === id) ?? auditAppGroups[0];
}

export function matchesAuditAppGroup(app: string, groupId: AuditAppGroupId, mode: "api" | "mock") {
  const group = getAuditAppGroup(groupId);
  if (group.id === "all") {
    return true;
  }
  const apps = mode === "api" ? group.apiApps : group.mockApps;
  return apps.includes(app);
}

export function getAuditAppLabel(app: string) {
  const labels: Record<string, string> = {
    "parameter-management": "参数工作流",
    "parameter-admin": "参数后台",
    parameters: "参数工作台",
    "log-analysis": "日志分析",
    logs: "日志分析",
    "log-admin": "日志后台",
    debugging: "调试平台",
    "debugging-admin": "调试后台",
    agent: "Agent",
    "user-governance": "用户治理",
    "user-permissions": "用户权限"
  };
  return labels[app] ?? app;
}
