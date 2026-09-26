import {
  canonicalManualSyncPrepareResponseSchema,
  catalogBatchValueChangeRequestResponseSchema
} from "@wiseeff/dto-schemas";
import type { z } from "zod";
import { createDefaultApiClient } from "./defaultApiClient";

export type ManualSyncPreparation = z.infer<typeof canonicalManualSyncPrepareResponseSchema>["item"];
export type ManualSyncSubmission = z.infer<typeof catalogBatchValueChangeRequestResponseSchema>["item"];

export function createCanonicalManualSyncClient(client = createDefaultApiClient()) {
  const post = async (path: string, body: unknown, requestId: string) =>
    (await client.raw(path, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Request-Id": requestId },
      body: JSON.stringify(body)
    })).json();
  return {
    async prepare(projectId: string, fileId: string, body: {
      contentBase64: string; expectedCurrentVersionId: string; expectedWorkflowProofToken: string
    }, requestId: string): Promise<ManualSyncPreparation> {
      return canonicalManualSyncPrepareResponseSchema.parse(await post(
        `/api/v1/projects/${encodeURIComponent(projectId)}/parameter-files/${encodeURIComponent(fileId)}/source-manual-sync/prepare`,
        body, requestId
      )).item;
    },
    async submit(projectId: string, body: {
      candidateId: string; expectedProofToken: string; reason: string; assignedToUserId: string
    }, requestId: string): Promise<ManualSyncSubmission> {
      return catalogBatchValueChangeRequestResponseSchema.parse(await post(
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-value-change-requests/batches`,
        body, requestId
      )).item;
    }
  };
}
