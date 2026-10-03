import {
  canonicalBatchRollbackPrepareResponseSchema,
  canonicalBatchRollbackSubmitRequestSchema,
  canonicalBatchRollbackSubmitResponseSchema
} from "@wiseeff/dto-schemas";
import type { z } from "zod";
import { createDefaultApiClient } from "./defaultApiClient";

export type BatchRollbackPreparation = z.infer<typeof canonicalBatchRollbackPrepareResponseSchema>["item"];
export type BatchRollbackSubmission = z.infer<typeof canonicalBatchRollbackSubmitResponseSchema>["item"];
export type BatchRollbackSubmitBody = z.infer<typeof canonicalBatchRollbackSubmitRequestSchema>;

export function createCanonicalBatchRollbackClient(client = createDefaultApiClient()) {
  const path = (projectId: string, fileId: string) =>
    `/api/v1/projects/${encodeURIComponent(projectId)}/parameter-files/${encodeURIComponent(fileId)}/source-batch-rollback`;
  const post = async (url: string, body: unknown, requestId: string) =>
    (await client.raw(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Request-Id": requestId },
      body: JSON.stringify(body)
    })).json();
  return {
    async prepare(projectId: string, fileId: string, body: {
      versionId: string; expectedCurrentVersionId: string; expectedWorkflowProofToken: string
    }, requestId: string): Promise<BatchRollbackPreparation> {
      return canonicalBatchRollbackPrepareResponseSchema.parse(
        await post(`${path(projectId, fileId)}/prepare`, body, requestId)
      ).item;
    },
    async submit(projectId: string, fileId: string, body: BatchRollbackSubmitBody,
      requestId: string): Promise<BatchRollbackSubmission> {
      return canonicalBatchRollbackSubmitResponseSchema.parse(
        await post(`${path(projectId, fileId)}/submit`, canonicalBatchRollbackSubmitRequestSchema.parse(body), requestId)
      ).item;
    }
  };
}
