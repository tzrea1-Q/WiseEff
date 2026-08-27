/**
 * Draft-staging vocabulary owned by the parameter-drafts module: the staged
 * change action, the draft DTO surface, and the write-lock fields persisted
 * on drafts/change requests. Both parameter workflow modules (parameters,
 * parameter-topology) import from here; this module imports neither.
 */

export type ParameterChangeAction = "set" | "delete";

export type ParameterDraftDto = {
  id: string;
  projectId: string;
  /**
   * DTO compatibility field.
   * Pre-cutover: project_parameter_value id.
   * Post-cutover: semantic project_parameter_binding id (same as projectParameterBindingId).
   */
  parameterId: string;
  targetValue: string;
  action: ParameterChangeAction;
  reason: string;
  updatedAt: string;
  /** Subject identity for topology enablement drafts. */
  editSubjectKind?: "binding" | "node-enablement";
  logicalNodeId?: string;
  /** Trusted execution identity for Agent/System drafts; omitted for legacy User rows. */
  initiatorType?: "user" | "agent" | "system";
  initiatorSystemKind?: "service" | "job";
  initiatorSystemName?: string;
  initiatorSessionId?: string;
  initiatorToolCallId?: string;
  initiatorApprovalId?: string;
  /** Semantic binding identity for topology-aware drafts. */
  projectParameterBindingId?: string;
  /** Working candidate revision tip for binding draft rounds. */
  candidateConfigRevisionId?: string;
  /** Spec id for topology-aware submit / tray hydration. */
  parameterSpecId?: string;
  /** Property / parameter display name for history surfaces. */
  name?: string;
  module?: string;
  /**
   * Baseline value for history diffs (write-lock base raw, else PPV current).
   * Must not silently fall back to the candidate tip.
   */
  currentValue?: string;
};

/** Persisted on drafts/change requests for exact merge writeback identity. */
export type BindingWriteLockFields = {
  baseConfigRevisionId: string;
  bindingRevisionId: string;
  propertyOccurrenceId?: string | null;
  sourceFileVersionId: string;
  expectedChecksum: string;
  occurrenceSpan?: { start: number; end: number } | null;
};

/** Enablement write locks omit bindingRevisionId — status is not a binding. */
export type EnablementWriteLockFields = Omit<BindingWriteLockFields, "bindingRevisionId">;
