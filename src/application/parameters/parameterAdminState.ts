export type ParameterAdminArea = "organization" | "projects";

export type ParameterAdminAuditHint = {
  kind:
    | "spec-review-resolved"
    | "spec-review-dismissed"
    | "spec-review-create-spec"
    | "spec-activated"
    | "spec-updated"
    | "spec-deprecated"
    | "spec-restored"
    | "module-created"
    | "module-renamed"
    | "module-moved"
    | "module-deleted"
    | "module-mapping-created"
    | "module-mapping-deleted"
    | "module-bindings-recomputed"
    | "import-batch-applied"
    | "identity-mapping-resolved"
    | "identity-mapping-dismissed"
    | "identity-mapping-new-identity"
    | "identity-mapping-reopened"
    | "project-updated"
    | "project-deleted"
    | "baseline-compared"
    | "baseline-rolled-back"
    | "baseline-released"
    | "config-set-exported"
    | "revision-validated"
    | "file-conflict-resolved";
  summary: string;
  reason: string;
  recordedAt: string;
};

export type ParameterAdminUndoEntry = {
  id: string;
  label: string;
};

export type ParameterAdminState = {
  selectedProjectId: string | null;
  selectedConfigRevisionId: string | null;
  queueCounts: {
    specReview: number;
    identityMapping: number;
    fileConflicts: number;
  };
  undoStack: ParameterAdminUndoEntry[];
  auditHints: ParameterAdminAuditHint[];
};

export type ParameterAdminAction =
  | { type: "SET_SELECTED_PROJECT"; projectId: string | null }
  | { type: "SET_SELECTED_CONFIG_REVISION"; revisionId: string | null }
  | {
      type: "SET_QUEUE_COUNTS";
      counts: Partial<ParameterAdminState["queueCounts"]>;
    }
  | { type: "PUSH_AUDIT_HINT"; hint: ParameterAdminAuditHint }
  | { type: "CLEAR_AUDIT_HINTS" }
  | { type: "PUSH_UNDO"; entry: ParameterAdminUndoEntry }
  | { type: "POP_UNDO" }
  | { type: "CLEAR_UNDO" };

export const initialParameterAdminState: ParameterAdminState = {
  selectedProjectId: null,
  selectedConfigRevisionId: null,
  queueCounts: {
    specReview: 0,
    identityMapping: 0,
    fileConflicts: 0
  },
  undoStack: [],
  auditHints: []
};

export function parameterAdminReducer(
  state: ParameterAdminState,
  action: ParameterAdminAction
): ParameterAdminState {
  switch (action.type) {
    case "SET_SELECTED_PROJECT":
      return { ...state, selectedProjectId: action.projectId };
    case "SET_SELECTED_CONFIG_REVISION":
      return { ...state, selectedConfigRevisionId: action.revisionId };
    case "SET_QUEUE_COUNTS":
      return {
        ...state,
        queueCounts: { ...state.queueCounts, ...action.counts }
      };
    case "PUSH_AUDIT_HINT":
      return {
        ...state,
        auditHints: [action.hint, ...state.auditHints].slice(0, 8)
      };
    case "CLEAR_AUDIT_HINTS":
      return { ...state, auditHints: [] };
    case "PUSH_UNDO":
      return { ...state, undoStack: [action.entry, ...state.undoStack].slice(0, 20) };
    case "POP_UNDO":
      return { ...state, undoStack: state.undoStack.slice(1) };
    case "CLEAR_UNDO":
      return { ...state, undoStack: [] };
    default:
      return state;
  }
}

export function auditKindForResolveDecision(
  decision: "resolved" | "dismissed",
  createSpec?: boolean
): ParameterAdminAuditHint["kind"] {
  if (createSpec) {
    return "spec-review-create-spec";
  }
  return decision === "dismissed" ? "spec-review-dismissed" : "spec-review-resolved";
}

export function auditKindLabel(kind: ParameterAdminAuditHint["kind"]): string {
  switch (kind) {
    case "spec-review-dismissed":
      return "定义匹配审核驳回";
    case "spec-review-create-spec":
      return "创建草稿定义";
    case "spec-activated":
      return "激活参数定义";
    case "spec-updated":
      return "更新参数定义";
    case "spec-deprecated":
      return "废弃参数定义";
    case "spec-restored":
      return "恢复参数定义";
    case "module-created":
      return "创建业务模块";
    case "module-renamed":
      return "重命名业务模块";
    case "module-moved":
      return "移动业务模块";
    case "module-deleted":
      return "删除业务模块";
    case "module-mapping-created":
      return "创建驱动归属";
    case "module-mapping-deleted":
      return "删除驱动归属";
    case "module-bindings-recomputed":
      return "重算模块归属";
    case "import-batch-applied":
      return "批量导入应用";
    case "identity-mapping-resolved":
      return "节点对应确认";
    case "identity-mapping-dismissed":
      return "节点对应驳回";
    case "identity-mapping-new-identity":
      return "声明新身份";
    case "identity-mapping-reopened":
      return "重新打开节点对应";
    case "project-updated":
      return "更新项目";
    case "project-deleted":
      return "删除项目";
    case "baseline-compared":
      return "基线对比";
    case "baseline-rolled-back":
      return "基线回滚";
    case "baseline-released":
      return "基线发布";
    case "config-set-exported":
      return "导出配置集";
    case "revision-validated":
      return "修订校验";
    case "file-conflict-resolved":
      return "文件冲突裁决";
    case "spec-review-resolved":
    default:
      return "定义匹配审核批准";
  }
}
