import type { WorkflowPublicationAdminState } from "@/domain/workflowPublication";
import type { WorkflowPublicationClient } from "@/infrastructure/http/workflowPublicationClient";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

export const INITIAL_MOCK_WORKFLOW_PUBLICATION = {
  workflows: { "parameter-management": true, debugging: true, "log-analysis": true, knowledge: true },
  version: 0
} as const;

export function createMockWorkflowPublicationClient(): WorkflowPublicationClient {
  let saved: WorkflowPublicationAdminState = { ...INITIAL_MOCK_WORKFLOW_PUBLICATION, updatedAt: null, updatedBy: null };
  return {
    async getPublication() { return structuredClone({ workflows: saved.workflows, version: saved.version }); },
    async getAdministration() { return structuredClone(saved); },
    async updatePublication(input) {
      if (input.expectedVersion !== saved.version) throw new WiseEffApiError("CONFLICT", "配置已被修改，请重新加载后保存。", {}, "");
      saved = { workflows: { ...input.workflows }, version: saved.version + 1, updatedAt: new Date().toISOString(), updatedBy: { id: "mock-admin", name: "演示管理员" } };
      return structuredClone(saved);
    }
  };
}
