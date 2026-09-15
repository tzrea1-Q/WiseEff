import type { BindingDraftResult, NodeEnablementDraftResult } from "@/application/ports/ParameterTopologyRepository";

export type PendingBindingDraftCore = BindingDraftResult & {
  projectId: string;
  reason: string;
};

export type PendingBindingDraft = PendingBindingDraftCore & {
  currentRawValue: string;
  /** Business module display name (same source as workbench「所属模块」). */
  moduleName: string;
};

export type PendingEnablementDraft = NodeEnablementDraftResult & {
  projectId: string;
  reason: string;
  nodeLabel: string;
  currentRawValue: string | null;
};

export type PendingTopologyDraft =
  | ({ kind: "binding" } & PendingBindingDraft)
  | ({ kind: "enablement" } & PendingEnablementDraft);

export function bindingDraftKey(projectParameterBindingId: string): string {
  return `binding:${projectParameterBindingId}`;
}

export function enablementDraftKey(logicalNodeId: string): string {
  return `enablement:${logicalNodeId}`;
}

export function isBindingDraft(draft: PendingTopologyDraft): draft is { kind: "binding" } & PendingBindingDraft {
  return draft.kind === "binding";
}

export function isEnablementDraft(draft: PendingTopologyDraft): draft is { kind: "enablement" } & PendingEnablementDraft {
  return draft.kind === "enablement";
}
