import { configSetImportPreviewBodySchema, configSetImportApplyBodySchema, configSetImportPreviewResponseSchema, configSetImportApplyResponseSchema,
  type ConfigSetImportBody } from "@wiseeff/dto-schemas";
import { createDefaultApiClient } from "./defaultApiClient";

export function createConfigSetPackageClient(client = createDefaultApiClient()) {
  const path = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/config-set-import`;
  return {
    async preview(projectId: string, body: ConfigSetImportBody) {
      return configSetImportPreviewResponseSchema.parse(await client.post(`${path(projectId)}/preview`, configSetImportPreviewBodySchema.parse(body))).item;
    },
    async apply(projectId: string, body: ConfigSetImportBody & { proofToken: string; reason: string; clientMutationId: string }) {
      return configSetImportApplyResponseSchema.parse(await client.post(`${path(projectId)}/apply`, configSetImportApplyBodySchema.parse(body))).item;
    }
  };
}
