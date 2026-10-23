export type AuditAppGroupId = "all" | "parameter" | "logs" | "debugging" | "agent" | "users" | "knowledge" | "feedback";

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
    apiApps: ["parameter-management", "parameter-admin", "parameters", "parameter-bindings", "parameter-catalog", "parameter-catalog-migration"],
    mockApps: ["parameter-management", "parameter-admin", "parameters", "parameter-bindings", "parameter-catalog", "parameter-catalog-migration", "parameter-review", "parameter-submissions"]
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
    apiApps: ["debugging", "device-bridge", "dts-reload"],
    mockApps: ["debugging", "debugging-admin", "node-debugging", "device-bridge", "dts-reload"]
  },
  { id: "agent", label: "智能助手", apiApps: ["agent", "wiseeff"], mockApps: ["agent", "wiseeff"] },
  {
    id: "users",
    label: "用户治理",
    apiApps: ["user-governance", "auth"],
    mockApps: ["user-governance", "user-permissions", "auth"]
  },
  { id: "knowledge", label: "知识库", apiApps: ["knowledge"], mockApps: ["knowledge"] },
  { id: "feedback", label: "产品反馈", apiApps: ["product-feedback"], mockApps: ["product-feedback"] }
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

export const AUDIT_APP_LABELS: Record<string, string> = {
    platform: "平台管理",
    "parameter-management": "参数工作流",
    "parameter-admin": "参数后台",
    parameters: "参数工作台",
    "parameter-bindings": "参数绑定",
    "parameter-catalog": "参数目录",
    "parameter-catalog-migration": "参数目录迁移",
    "parameter-review": "参数审阅",
    "parameter-submissions": "参数提交",
    "log-analysis": "日志分析",
    logs: "日志分析",
    "log-admin": "日志后台",
    debugging: "调试平台",
    "debugging-admin": "调试后台",
    "node-debugging": "节点调试",
    "device-bridge": "设备连接",
    "dts-reload": "参数重载",
    agent: "智能助手",
    wiseeff: "智能助手",
    auth: "账号与登录",
    knowledge: "知识库",
    "product-feedback": "产品反馈",
    "user-governance": "用户治理",
    "user-permissions": "用户权限"
};

export function getAuditAppLabel(app: string) {
  return Object.hasOwn(AUDIT_APP_LABELS, app) ? AUDIT_APP_LABELS[app] : "未分类模块";
}
