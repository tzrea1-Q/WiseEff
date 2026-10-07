import {
  canonicalManualSyncPrepareResponseSchema,
  catalogSubmitBatchValueChangeRequestSchema,
  catalogBatchValueChangeRequestResponseSchema,
  canonicalManualSyncSingleSubmitRequestSchema, canonicalManualSyncSingleSubmitResponseSchema,
  catalogValueChangeRequestListResponseSchema, catalogValueChangeSourceDiffResponseSchema
} from "@wiseeff/dto-schemas";
import type { z } from "zod";
import { createDefaultApiClient } from "./defaultApiClient";

export type ManualSyncPreparation = z.infer<typeof canonicalManualSyncPrepareResponseSchema>["item"];
export type ManualSyncSubmission = z.infer<typeof catalogBatchValueChangeRequestResponseSchema>["item"];
type ManualSyncBatchBody = z.infer<typeof catalogSubmitBatchValueChangeRequestSchema> & {
  targetDecisions: NonNullable<z.infer<typeof catalogSubmitBatchValueChangeRequestSchema>["targetDecisions"]>;
};

export function createCanonicalManualSyncClient(client = createDefaultApiClient()) {
  const post = async (path: string, body: unknown, requestId: string) =>
    (await client.raw(path, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Request-Id": requestId },
      body: JSON.stringify(body)
    })).json();
  return {
    async submitSingle(projectId: string, candidateId: string,
      body: z.infer<typeof canonicalManualSyncSingleSubmitRequestSchema>, requestId: string) {
      return canonicalManualSyncSingleSubmitResponseSchema.parse(await post(
        `/api/v1/projects/${encodeURIComponent(projectId)}/parameter-file-candidates/${encodeURIComponent(candidateId)}/source-submit`,
        canonicalManualSyncSingleSubmitRequestSchema.parse(body), requestId
      )).item;
    },
    async readSingleReceipt(projectId: string, requestId: string) {
      const path = `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-value-change-requests`;
      const [requests, source] = await Promise.all([client.get(`${path}?mine=true`),
        client.get(`${path}/${encodeURIComponent(requestId)}/source-diff`)]);
      const receipt = catalogValueChangeRequestListResponseSchema.parse(requests).items.find((item) => item.id === requestId);
      if (!receipt) throw new Error("Owned single source receipt is unavailable.");
      return { receipt, diff: catalogValueChangeSourceDiffResponseSchema.parse(source).item };
    },
    async prepare(projectId: string, fileId: string, body: {
      contentBase64: string; expectedCurrentVersionId: string; expectedWorkflowProofToken: string
    }, requestId: string): Promise<ManualSyncPreparation> {
      return canonicalManualSyncPrepareResponseSchema.parse(await post(
        `/api/v1/projects/${encodeURIComponent(projectId)}/parameter-files/${encodeURIComponent(fileId)}/source-manual-sync/prepare`,
        body, requestId
      )).item;
    },
    async submit(projectId: string, body: ManualSyncBatchBody, requestId: string): Promise<ManualSyncSubmission> {
      return catalogBatchValueChangeRequestResponseSchema.parse(await post(
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-value-change-requests/batches`,
        catalogSubmitBatchValueChangeRequestSchema.parse(body), requestId
      )).item;
    }
  };
}
