import { z } from "zod";
import { memberAdditionApplyBodySchema, memberAdditionApplyResponseSchema, memberAdditionBodySchema, memberAdditionPreviewResponseSchema } from "@wiseeff/dto-schemas";
import { createDefaultApiClient } from "./defaultApiClient";

export type MemberAdditionBody = z.infer<typeof memberAdditionBodySchema>;
export type MemberAdditionPreview = z.infer<typeof memberAdditionPreviewResponseSchema>["item"];
export function createCanonicalMemberAdditionClient(client = createDefaultApiClient()) {
  const path = (projectId: string, configSetId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/config-sets/${encodeURIComponent(configSetId)}/member-addition`;
  return {
    async upload(projectId: string, file: File) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      const result = await client.post<{ item: { id: string; format: "dts" | "json"; fileName: string } }>(`/api/v1/projects/${encodeURIComponent(projectId)}/parameter-file-candidates`,
        { fileName: file.name, contentBase64: btoa(binary) });
      return result.item;
    },
    async preview(projectId: string, configSetId: string, body: MemberAdditionBody) {
      return memberAdditionPreviewResponseSchema.parse(await client.post(`${path(projectId, configSetId)}/preview`, memberAdditionBodySchema.parse(body))).item;
    },
    async apply(projectId: string, configSetId: string, body: z.infer<typeof memberAdditionApplyBodySchema>) {
      return memberAdditionApplyResponseSchema.parse(await client.post(`${path(projectId, configSetId)}/apply`, memberAdditionApplyBodySchema.parse(body))).item;
    }
  };
}
