import { workflowPublicationAdminStateSchema, workflowPublicationStateSchema } from "@wiseeff/dto-schemas";
import type { UpdateWorkflowPublicationInput, WorkflowPublicationAdminState, WorkflowPublicationState } from "@/domain/workflowPublication";
import { createDefaultApiClient } from "./defaultApiClient";
import { parseContractDto } from "./parseContractDto";

export type WorkflowPublicationClient = {
  getPublication(): Promise<WorkflowPublicationState>;
  getAdministration(): Promise<WorkflowPublicationAdminState>;
  updatePublication(input: UpdateWorkflowPublicationInput): Promise<WorkflowPublicationAdminState>;
};

export function createWorkflowPublicationClient(api = createDefaultApiClient()): WorkflowPublicationClient {
  return {
    async getPublication() {
      const body = await api.get<{ item: unknown }>("/api/v1/workflow-publication");
      return parseContractDto(workflowPublicationStateSchema, body?.item, "WorkflowPublicationState");
    },
    async getAdministration() {
      const body = await api.get<{ item: unknown }>("/api/v1/admin/workflow-publication");
      return parseContractDto(workflowPublicationAdminStateSchema, body?.item, "WorkflowPublicationAdminState");
    },
    async updatePublication(input) {
      const body = await api.put<{ item: unknown }>("/api/v1/admin/workflow-publication", input);
      return parseContractDto(workflowPublicationAdminStateSchema, body?.item, "WorkflowPublicationAdminState");
    }
  };
}
