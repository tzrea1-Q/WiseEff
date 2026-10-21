import { administratorMemberRemovalApplyRequestSchema, administratorMemberRemovalPreviewResponseSchema,
  administratorMemberRemovalApplyResponseSchema } from "@wiseeff/dto-schemas";
import type { z } from "zod";
import { createDefaultApiClient } from "./defaultApiClient";

export type AdministratorMemberRemovalPreview = z.infer<typeof administratorMemberRemovalPreviewResponseSchema>["item"];
export function createAdministratorMemberRemovalClient(client = createDefaultApiClient()) {
  const path = (projectId: string, configSetId: string, fileId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/config-sets/${encodeURIComponent(configSetId)}/files/${encodeURIComponent(fileId)}`;
  return {
    async preview(projectId: string, configSetId: string, fileId: string) {
      return administratorMemberRemovalPreviewResponseSchema.parse(await client.post(`${path(projectId, configSetId, fileId)}/removal-preview`, {})).item;
    },
    async apply(projectId: string, configSetId: string, fileId: string, body: z.infer<typeof administratorMemberRemovalApplyRequestSchema>) {
      return administratorMemberRemovalApplyResponseSchema.parse(await client.post(`${path(projectId, configSetId, fileId)}/removal-apply`,
        administratorMemberRemovalApplyRequestSchema.parse(body))).item;
    }
  };
}
