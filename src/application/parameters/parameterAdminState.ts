export type ParameterAdminArea = "organization" | "projects";

export type ParameterAdminAuditHint = {
  kind: "spec-review-resolved" | "spec-review-dismissed" | "spec-review-create-spec";
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
