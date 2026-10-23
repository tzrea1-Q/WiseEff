import type { WorkflowId } from "./workflowDiscovery";

export type WorkflowPublicationState = {
  workflows: Record<WorkflowId, boolean>;
  version: number;
};

export type WorkflowPublicationAdminState = WorkflowPublicationState & {
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
};

export type UpdateWorkflowPublicationInput = {
  workflows: Record<WorkflowId, boolean>;
  expectedVersion: number;
};
