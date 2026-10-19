import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { SourceRevisionRequest } from "../../../../src/application/ports/ParameterFileRepository";
import type { SourceRevisionRequestDto } from "../../parameter-files/sourceRevisionRoutes";
import { buildOpenApiDocument } from "../openapi";
import { dtoSchemaCatalog } from "./index";
import { canonicalSourceCandidatePreviewResponseSchema } from "./canonicalConflict";
import {
  canonicalSourceSubmitRequestSchema,
  createParameterFileCandidateRequestSchema,
  sourceRevisionRequestDetailResponseSchema,
  sourceRevisionRequestDtoSchema,
  sourceRevisionReviewRequestSchema,
  sourceRevisionWithdrawRequestSchema
} from "./sourceRevision";

type Expect<T extends true> = T;
const alignment: [
  Expect<SourceRevisionRequestDto extends z.infer<typeof sourceRevisionRequestDtoSchema> ? true : false>,
  Expect<z.infer<typeof sourceRevisionRequestDtoSchema> extends SourceRevisionRequest ? true : false>
] = [true, true];

const digest = "a".repeat(64);
const impact = { parameterChanges: 0, nodeAdditions: 0, nodeRemovals: 0 };
const preview = { kind: "source_revision", format: "dts", candidateId: "candidate", fileId: "file", configSetId: "set",
  baseVersionId: "v1", configRevisionId: "revision", before: "/ {};\r\n", after: "/ {}; // comment\r\n",
  proofToken: digest, baseDigest: digest, proposedDigest: digest, canSubmit: true, diagnostics: [], impact,
  reviewers: [{ userId: "reviewer", name: "Reviewer" }] };
const request: SourceRevisionRequest = { id: "request", projectId: "project", candidateId: "candidate", fileId: "file", fileName: "board.dts",
  configSetId: "set", status: "pending", reason: "Keep a comment", submitterUserId: "author", assignedToUserId: "reviewer",
  reviewerUserId: null, reviewerNote: null, createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z", proofDigest: digest, impact };

describe("whole-source public contracts", () => {
  it("retains ordinary uploads and requires both original versions and a mutation key for source editing", () => {
    const legacy = { fileName: "board.dts", contentBase64: "LyB7fTs=" };
    expect(createParameterFileCandidateRequestSchema.parse(legacy)).toEqual(legacy);
    const source = { ...legacy, fileId: "file", intent: "source_revision", expectedCurrentVersionId: "v1", expectedConfigRevisionId: "revision", clientMutationId: "mutation" };
    expect(createParameterFileCandidateRequestSchema.safeParse(source).success).toBe(true);
    for (const field of ["fileId", "expectedCurrentVersionId", "expectedConfigRevisionId", "clientMutationId"]) {
      const missing: Record<string, unknown> = { ...source };
      delete missing[field];
      expect(createParameterFileCandidateRequestSchema.safeParse(missing).success, field).toBe(false);
    }
    expect(canonicalSourceSubmitRequestSchema.parse({ expectedCurrentVersionId: "v1", expectedProofToken: digest,
      assignedToUserId: "reviewer", clientMutationId: "mutation", reason: "Edit source" }).clientMutationId).toBe("mutation");
  });

  it("admits explicit zero-target source previews while preserving legacy/canonical variants", () => {
    expect(canonicalSourceCandidatePreviewResponseSchema.parse({ item: preview }).item).toEqual(preview);
    for (const kind of ["legacy", "canonical"]) {
      expect(canonicalSourceCandidatePreviewResponseSchema.safeParse({ item: { kind, candidateId: "candidate", format: "dts", canSubmit: false } }).success).toBe(true);
    }
    const { proofToken: _proof, ...incomplete } = preview;
    expect(canonicalSourceCandidatePreviewResponseSchema.safeParse({ item: incomplete }).success).toBe(false);
    expect(canonicalSourceCandidatePreviewResponseSchema.safeParse({ item: { ...preview,
      request: { id: "request", kind: "source_revision", status: "pending" } } }).success).toBe(true);
    expect(canonicalSourceCandidatePreviewResponseSchema.safeParse({ item: { ...preview,
      request: { requestId: "request", kind: "source_revision", status: "pending" } } }).success).toBe(false);
  });

  it("keeps public reader DTOs aligned and requires verified source bytes on detail", () => {
    expect(alignment).toEqual([true, true]);
    expect(sourceRevisionRequestDtoSchema.safeParse(request).success).toBe(true);
    expect(sourceRevisionRequestDetailResponseSchema.safeParse({ item: request }).success).toBe(false);
    expect(sourceRevisionRequestDetailResponseSchema.parse({ item: { ...request, before: preview.before, after: preview.after } }).item.after).toBe(preview.after);
    expect(sourceRevisionRequestDtoSchema.safeParse({ ...request, source_revision_context: { storageKey: "private" } }).success).toBe(false);
    expect(sourceRevisionReviewRequestSchema.safeParse({ decision: "approve", proofDigest: digest }).success).toBe(true);
    expect(sourceRevisionReviewRequestSchema.safeParse({ decision: "approve" }).success).toBe(false);
    expect(sourceRevisionWithdrawRequestSchema.safeParse({}).success).toBe(true);
    expect(sourceRevisionWithdrawRequestSchema.safeParse({ requestId: "another" }).success).toBe(false);
  });

  it("publishes concrete source request endpoints and schemas rather than placeholder objects", () => {
    const document = buildOpenApiDocument();
    const path = "/api/v2/projects/{projectId}/source-revision-requests";
    expect(document.paths[path].get?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "mine", in: "query" }), expect.objectContaining({ name: "status", in: "query" })
    ]));
    expect(document.paths[`${path}/{requestId}`].get?.responses["200"]).toMatchObject({
      content: { "application/json": { schema: { $ref: "#/components/schemas/SourceRevisionRequestDetailResponse" } } }
    });
    expect(document.paths[`${path}/{requestId}/review`].post?.requestBody).toMatchObject({
      content: { "application/json": { schema: { $ref: "#/components/schemas/SourceRevisionReviewRequest" } } }
    });
    expect(document.paths[`${path}/{requestId}/withdraw`].post?.requestBody).toMatchObject({
      content: { "application/json": { schema: { $ref: "#/components/schemas/SourceRevisionWithdrawRequest" } } }
    });
    expect(document.components.schemas.SourceRevisionRequestDetailResponse).toMatchObject({
      properties: { item: { required: expect.arrayContaining(["proofDigest", "before", "after", "impact"]) } }
    });
    expect(document.components.schemas.CreateParameterFileCandidateRequest).toMatchObject({ anyOf: expect.arrayContaining([
      expect.objectContaining({ required: expect.arrayContaining(["intent", "expectedCurrentVersionId", "expectedConfigRevisionId", "clientMutationId"]) })
    ]) });
    expect(dtoSchemaCatalog.CanonicalSourceSubmitRequest).toBe(canonicalSourceSubmitRequestSchema);
  });
});
