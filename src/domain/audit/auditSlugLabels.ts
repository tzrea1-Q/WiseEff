/**
 * Audit-center presentation labels for backend event slugs (FA-17): known
 * kind/action slugs map to product Chinese; Chinese payloads pass through;
 * unknown slugs surface verbatim flagged `isRaw` so views can render them in
 * code style instead of pretending they are copy. Display-layer only — the
 * stored audit events are untouched.
 */

const CJK_PATTERN = /[\u4e00-\u9fff]/;

export const AUDIT_KIND_LABELS: Record<string, string> = {
  "parameter-merge": "参数合入",
  "parameter-review-advance": "审阅推进",
  "parameter-review-reject": "审阅打回",
  "parameter-submit": "参数提交",
  "parameter-update": "参数更新",
  "parameter-add": "新增参数",
  "parameter-delete": "删除参数",
  "parameter-structured-edit-submit": "结构化修改提交",
  "parameter-submission-withdraw": "提交撤回",
  "parameter-sensitive-node-denied": "敏感节点拦截",
  "parameter-topology-governance": "拓扑治理",
  "parameter-writeback-to-file": "参数写回文件",
  "batch-import": "批量导入",
  "bulk-risk-change": "批量风险调整",
  "bulk-module-change": "批量模块调整",
  "bulk-delete": "批量删除",
  "user-role-change": "角色变更",
  "user-role-replace": "角色变更",
  "user-add": "新增用户",
  "user-create": "创建用户",
  "user-update": "更新用户",
  "user-toggle": "用户状态",
  "user-activation": "用户启停",
  "registration-role-request": "注册角色申请",
  "auth-event": "认证事件",
  "session-created": "会话创建",
  "debug-node-write": "节点写入",
  "debug-node-read": "节点读取",
  "debug-session-create": "调试会话创建",
  "debug-snapshot-rollback": "快照回滚",
  "debug-target-detect": "目标检测",
  "debug-node-admin-create": "调试节点登记",
  "debug-node-admin-update": "调试节点更新",
  "debug-node-module-admin-create": "节点目录创建",
  "debug-node-module-admin-update": "节点目录更新",
  "debug-node-module-admin-move": "节点目录移动",
  "debug-node-module-admin-delete": "节点目录删除",
  "debug-parameter-admin-create": "调试参数登记",
  "debug-parameter-admin-update": "调试参数更新",
  "debug-parameter-admin-archive": "调试参数归档",
  "debug-parameter-admin-restore": "调试参数恢复",
  "debug-node-binding-admin-upsert": "节点绑定维护",
  "debug-node-binding-admin-archive": "节点绑定归档",
  "debug-parameter-binding-admin-upsert": "参数绑定维护",
  "debug-parameter-binding-admin-archive": "参数绑定归档",
  "device-bridge-pair": "Bridge 配对",
  "device-bridge-rename": "Bridge 重命名",
  "device-bridge-revoke": "Bridge 撤销",
  "device-bridge-pairing-code-issue": "Bridge 配对码签发",
  "dts-reload-configuration-update": "重载配置更新",
  "dts-reload-agent-refused": "Agent 重载拒绝",
  "dts-reload-sensitive-node-denied": "重载敏感节点拦截",
  "agent-action": "Agent 操作",
  "agent-session": "Agent 会话",
  "agent-message": "Agent 消息",
  "agent-tool": "Agent 工具调用",
  export: "导出",
  "rollback-undo": "撤销操作",
  "parameter-file-upload": "参数文件上传",
  "parameter-file-sync": "参数文件同步",
  "parameter-file-candidate-create": "创建候选文件版本",
  "parameter-file-candidate-abandon": "放弃候选文件版本",
  "parameter-file-candidate-recompute": "重算候选影响",
  "parameter-file-candidate-activate": "候选版本启用",
  "parameter-file-candidate-stale": "候选版本过期",
  "parameter-file-conflict-open": "文件冲突登记",
  "parameter-file-conflict-resolve": "文件冲突裁决",
  baseline: "发布基线",
  "file-conflict-resolved": "冲突裁决",
  "parameter-module-admin-create": "参数模块创建",
  "parameter-module-admin-update": "参数模块更新",
  "parameter-module-admin-move": "参数模块移动",
  "parameter-module-admin-delete": "参数模块删除",
  "parameter-module-bindings-recomputed": "模块绑定重算",
  "parameter-module-mapping-created": "模块映射创建",
  "parameter-module-mapping-deleted": "模块映射删除",
  "parameter-module-compatible-dismissed": "兼容建议忽略",
  "parameter-module-compatible-restored": "兼容建议恢复",
  "parameter-module-driver-registered": "驱动登记",
  "parameter-module-driver-registration-updated": "驱动登记更新",
  "parameter-module-driver-group-disbanded": "驱动组解散",
  "parameter-module-driver-placement-replayed": "驱动归属重放",
  "parameter-module-driver-default-business-category-updated": "驱动默认业务域更新",
  "log-upload": "日志上传",
  "log-upload-failed": "日志上传失败",
  "log-rerun": "重新分析",
  "log-archive": "日志归档",
  "log-unarchive": "日志取消归档",
  "log-feedback": "日志反馈",
  "log-analysis": "日志分析",
  "log-domain-create": "业务域创建",
  "log-domain-update": "业务域更新",
  "log-domain-archive": "业务域归档",
  "log-domain-knowledge-links-update": "业务域知识关联更新",
  "knowledge-entry-create": "知识条目创建",
  "knowledge-entry-update": "知识条目更新",
  "knowledge-entry-publish": "知识条目发布",
  "knowledge-entry-reject": "知识条目拒绝",
  "knowledge-entry-archive": "知识条目归档",
  "knowledge-entry-restore": "知识条目恢复",
  "knowledge-entry-delete": "知识条目删除",
  "knowledge-entry-distill": "知识沉淀",
  "knowledge-entry-agent-draft": "知识 Agent 草稿",
  "knowledge-index-rebuild": "知识索引重建",
  "knowledge-index-retry": "知识索引重试",
  "knowledge-revision-restore": "知识版本恢复",
  "product-feedback-create": "提交产品反馈",
  "product-feedback-update": "更新产品反馈",
  "project-created": "项目创建",
  "project-updated": "项目更新",
  "project-deleted": "项目删除",
  "project-initialization-submitted": "参数初始化提交",
  "project-initialization-approved": "参数初始化通过",
  "project-initialization-rejected": "参数初始化驳回",
  "resolve-governance-task": "治理任务处理",
  "identity-ambiguity": "身份歧义",
  unknown: "未知事件"
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  merge: "合入参数",
  advance: "推进审阅",
  reject: "打回变更",
  submit: "提交变更",
  apply: "应用导入",
  create: "创建",
  created: "创建",
  update: "更新",
  updated: "更新",
  delete: "删除",
  abandon: "放弃",
  recompute: "重算影响",
  upload: "上传",
  "upload-failed": "上传失败",
  sync: "同步",
  release: "发布",
  released: "发布",
  restore: "恢复",
  "restore-revision": "恢复历史版本",
  resolve: "裁决",
  login: "登录",
  logout: "登出",
  register: "登记",
  "bootstrap-admin": "初始化管理员",
  "replace-roles": "调整角色",
  "update-profile": "更新资料",
  approve: "批准",
  deny: "拒绝",
  activate: "启用",
  activated: "启用",
  archive: "归档",
  archived: "归档",
  unarchive: "取消归档",
  read: "读取",
  write: "写入",
  rollback: "回滚",
  detect: "检测",
  rerun: "重新分析",
  retry: "重试",
  run: "运行",
  publish: "发布",
  distill: "沉淀",
  feedback: "反馈",
  "index-rebuild": "索引重建",
  "index-retry": "索引重试",
  "agent-draft-create": "Agent 草稿创建",
  dismiss: "忽略",
  disband: "解散",
  move: "移动",
  configure: "配置",
  deploy: "部署",
  preview: "预览",
  open: "登记",
  withdraw: "撤回",
  revoke: "撤销",
  writeback: "写回",
  blocked: "已拦截",
  failed: "失败",
  succeeded: "成功",
  verified: "已验证",
  requested: "已申请"
};

export type AuditSlugPresentation = {
  label: string;
  /** True when no mapping exists — views should render the raw slug in code style. */
  isRaw: boolean;
};

function present(labels: Record<string, string>, value: string): AuditSlugPresentation {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return { label: "未知", isRaw: false };
  }
  // Free-form Chinese payloads (mock actions like 「更新 CPU 频率」) are copy already.
  if (CJK_PATTERN.test(trimmed)) {
    return { label: trimmed, isRaw: false };
  }
  const mapped = labels[trimmed];
  if (mapped) {
    return { label: mapped, isRaw: false };
  }
  return { label: trimmed, isRaw: true };
}

export function presentAuditKind(kind: string): AuditSlugPresentation {
  return present(AUDIT_KIND_LABELS, kind);
}

export function presentAuditAction(action: string): AuditSlugPresentation {
  return present(AUDIT_ACTION_LABELS, action);
}
