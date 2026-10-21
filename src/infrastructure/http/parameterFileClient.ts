import type {
  ActivateParameterFileCandidateInput,
  ActivateParameterFileCandidateResult,
  CreateParameterFileCandidateInput,
  DownloadParameterFileCandidateResult,
  DownloadParameterFileVersionResult,
  FileSyncSummary,
  IngestDriverSummary,
  ParameterFileCandidate,
  ParameterFileCandidateImpact,
  ParameterFileConflictBulkPreview,
  ParameterFileConflictBulkResolveResult,
  ParameterFileSourcePreview,
  ParameterFileSourceReviewResult,
  ParameterFileSourceWorkflow,
  RollbackParameterFileSourceReviewInput,
  RollbackParameterFileVersionResult,
  ParameterFileRepository,
  ParameterFileSyncConflict,
  PreviewBulkConflictResolutionInput,
  ProjectParameterFile,
  ProjectParameterFileVersion,
  ResolveConflictsBulkInput,
  ResolveParameterFileConflictInput,
  SubmitParameterFileSourceReviewInput,
  SourceRevisionRequest,
  UploadParameterFileInput
} from "@/application/ports/ParameterFileRepository";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";

type ItemsEnvelope<T> = { items: T[] };
type ItemEnvelope<T> = { item: T };
type UploadFileEnvelope = {
  item: ProjectParameterFile;
  version: ProjectParameterFileVersion;
  driverSummary?: IngestDriverSummary;
};
type UploadVersionEnvelope = {
  item: ProjectParameterFileVersion;
  driverSummary?: IngestDriverSummary;
};
type ApiClient = ReturnType<typeof createApiClient>;

function contentDispositionFileName(header: string | null) {
  if (!header) {
    return undefined;
  }

  const match = /filename="([^"]+)"/i.exec(header);
  return match?.[1];
}

function routeProjectFiles(projectId: string) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/parameter-files`;
}

function routeFileVersions(projectId: string, fileId: string) {
  return `${routeProjectFiles(projectId)}/${encodeURIComponent(fileId)}/versions`;
}

function routeVersionContent(projectId: string, fileId: string, versionId: string) {
  return `${routeFileVersions(projectId, fileId)}/${encodeURIComponent(versionId)}/content`;
}

function routeFileSync(projectId: string, fileId: string) {
  return `${routeProjectFiles(projectId)}/${encodeURIComponent(fileId)}/sync`;
}

function routeProjectConflicts(projectId: string) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/parameter-file-conflicts`;
}

function routeResolveConflict(projectId: string, conflictId: string) {
  return `${routeProjectConflicts(projectId)}/${encodeURIComponent(conflictId)}/resolve`;
}

function routeBulkConflictPreview(projectId: string) {
  return `${routeProjectConflicts(projectId)}/bulk-preview`;
}

function routeBulkConflictResolve(projectId: string) {
  return `${routeProjectConflicts(projectId)}/bulk-resolve`;
}

function routeProjectCandidates(projectId: string) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/parameter-file-candidates`;
}

function routeCandidate(projectId: string, candidateId: string) {
  return `${routeProjectCandidates(projectId)}/${encodeURIComponent(candidateId)}`;
}

function routeSourceWorkflow(projectId: string, fileId: string) {
  return `${routeProjectFiles(projectId)}/${encodeURIComponent(fileId)}/source-workflow`;
}

function routeCandidateSourcePreview(projectId: string, candidateId: string) {
  return `${routeCandidate(projectId, candidateId)}/source-preview`;
}

export function createParameterFileClient(client: ApiClient = createDefaultApiClient()): ParameterFileRepository {
  return {
    async listSourceRevisionRequests(projectId, query = {}) {
      const params = new URLSearchParams();
      if (query.mine) params.set("mine", "true");
      if (query.status) params.set("status", query.status);
      const response = await client.get<{ items: SourceRevisionRequest[] }>(
        `/api/v2/projects/${encodeURIComponent(projectId)}/source-revision-requests?${params}`);
      return response.items;
    },
    async getSourceRevisionRequest(projectId, requestId) {
      const response = await client.get<ItemEnvelope<SourceRevisionRequest>>(
        `/api/v2/projects/${encodeURIComponent(projectId)}/source-revision-requests/${encodeURIComponent(requestId)}`);
      return response.item;
    },
    async reviewSourceRevisionRequest(projectId, requestId, input) {
      const response = await client.post<ItemEnvelope<SourceRevisionRequest>>(
        `/api/v2/projects/${encodeURIComponent(projectId)}/source-revision-requests/${encodeURIComponent(requestId)}/review`, input);
      return response.item;
    },
    async withdrawSourceRevisionRequest(projectId, requestId) {
      const response = await client.post<ItemEnvelope<SourceRevisionRequest>>(
        `/api/v2/projects/${encodeURIComponent(projectId)}/source-revision-requests/${encodeURIComponent(requestId)}/withdraw`, {});
      return response.item;
    },
    async cancelSourceRevisionRequest(projectId, requestId, input) {
      const response = await client.post<ItemEnvelope<SourceRevisionRequest>>(
        `/api/v2/projects/${encodeURIComponent(projectId)}/source-revision-requests/${encodeURIComponent(requestId)}/cancel`, input);
      return response.item;
    },
    async reassignSourceRevisionRequest(projectId, requestId, input) {
      const response = await client.post<ItemEnvelope<SourceRevisionRequest>>(
        `/api/v2/projects/${encodeURIComponent(projectId)}/source-revision-requests/${encodeURIComponent(requestId)}/reassign`, input);
      return response.item;
    },
    async listFiles(projectId: string) {
      const response = await client.get<ItemsEnvelope<ProjectParameterFile>>(routeProjectFiles(projectId));
      return response.items;
    },
    async uploadFile(projectId: string, input: UploadParameterFileInput) {
      const response = await client.post<UploadFileEnvelope>(routeProjectFiles(projectId), input);
      return {
        item: response.item,
        version: response.version,
        ...(response.driverSummary ? { driverSummary: response.driverSummary } : {}),
      };
    },
    async uploadVersion(projectId: string, fileId: string, input: UploadParameterFileInput) {
      const response = await client.post<UploadVersionEnvelope>(
        routeFileVersions(projectId, fileId),
        input,
      );
      return {
        item: response.item,
        ...(response.driverSummary ? { driverSummary: response.driverSummary } : {}),
      };
    },
    async listVersions(projectId: string, fileId: string) {
      const response = await client.get<ItemsEnvelope<ProjectParameterFileVersion>>(routeFileVersions(projectId, fileId));
      return response.items;
    },
    async rollbackVersion(projectId: string, fileId: string, versionId: string): Promise<RollbackParameterFileVersionResult> {
      const response = await client.post<RollbackParameterFileVersionResult>(
        `${routeFileVersions(projectId, fileId)}/${encodeURIComponent(versionId)}/rollback`,
        {}
      );
      return { item: response.item, file: response.file };
    },
    async downloadVersion(projectId: string, fileId: string, versionId: string): Promise<DownloadParameterFileVersionResult> {
      const response = await client.raw(routeVersionContent(projectId, fileId, versionId), {
        method: "GET",
        headers: { Accept: "*/*" }
      });
      return {
        contentType: response.headers.get("Content-Type") ?? "application/octet-stream",
        fileName: contentDispositionFileName(response.headers.get("Content-Disposition")),
        bytes: new Uint8Array(await response.arrayBuffer())
      };
    },
    async syncFile(projectId: string, fileId: string) {
      const response = await client.post<ItemEnvelope<FileSyncSummary>>(routeFileSync(projectId, fileId), {});
      return response.item;
    },
    async getSourceWorkflow(projectId: string, fileId: string) {
      const response = await client.get<ItemEnvelope<ParameterFileSourceWorkflow>>(
        routeSourceWorkflow(projectId, fileId)
      );
      return response.item;
    },
    async listConflicts(projectId: string) {
      const response = await client.get<ItemsEnvelope<ParameterFileSyncConflict>>(routeProjectConflicts(projectId));
      return response.items;
    },
    async resolveConflict(projectId: string, conflictId: string, input: ResolveParameterFileConflictInput) {
      const body: ResolveParameterFileConflictInput = {
        resolution: input.resolution,
        ...(input.reason ? { reason: input.reason } : {})
      };
      const response = await client.post<ItemEnvelope<ParameterFileSyncConflict>>(
        routeResolveConflict(projectId, conflictId),
        body
      );
      return response.item;
    },
    async previewBulkConflictResolution(projectId: string, input: PreviewBulkConflictResolutionInput) {
      const response = await client.post<ParameterFileConflictBulkPreview>(routeBulkConflictPreview(projectId), input);
      return response;
    },
    async resolveConflictsBulk(projectId: string, input: ResolveConflictsBulkInput) {
      const body: ResolveConflictsBulkInput = {
        resolution: input.resolution,
        conflictIds: input.conflictIds,
        ...(input.reason ? { reason: input.reason } : {})
      };
      const response = await client.post<ParameterFileConflictBulkResolveResult>(
        routeBulkConflictResolve(projectId),
        body
      );
      return response;
    },
    async listCandidates(projectId, options) {
      const query = new URLSearchParams();
      if (options?.fileId) query.set("fileId", options.fileId);
      if (options?.includeAbandoned) query.set("includeAbandoned", "true");
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const response = await client.get<ItemsEnvelope<ParameterFileCandidate>>(
        `${routeProjectCandidates(projectId)}${suffix}`
      );
      return response.items;
    },
    async createCandidate(projectId, input: CreateParameterFileCandidateInput) {
      const response = await client.post<ItemEnvelope<ParameterFileCandidate>>(routeProjectCandidates(projectId), input);
      return response.item;
    },
    async getCandidate(projectId, candidateId) {
      const response = await client.get<ItemEnvelope<ParameterFileCandidate>>(routeCandidate(projectId, candidateId));
      return response.item;
    },
    async getCandidateImpact(projectId, candidateId) {
      const response = await client.get<{ item: ParameterFileCandidate; impact: ParameterFileCandidateImpact }>(
        `${routeCandidate(projectId, candidateId)}/impact`
      );
      return { item: response.item, impact: response.impact };
    },
    async downloadCandidate(projectId, candidateId): Promise<DownloadParameterFileCandidateResult> {
      const response = await client.raw(`${routeCandidate(projectId, candidateId)}/content`, {
        method: "GET",
        headers: { Accept: "*/*" }
      });
      return {
        contentType: response.headers.get("Content-Type") ?? "application/octet-stream",
        fileName: contentDispositionFileName(response.headers.get("Content-Disposition")),
        bytes: new Uint8Array(await response.arrayBuffer())
      };
    },
    async abandonCandidate(projectId, candidateId) {
      const response = await client.post<ItemEnvelope<ParameterFileCandidate>>(
        `${routeCandidate(projectId, candidateId)}/abandon`,
        {}
      );
      return response.item;
    },
    async recomputeCandidate(projectId, candidateId) {
      const response = await client.post<ItemEnvelope<ParameterFileCandidate>>(
        `${routeCandidate(projectId, candidateId)}/recompute`,
        {}
      );
      return response.item;
    },
    async activateCandidate(
      projectId,
      candidateId,
      input: ActivateParameterFileCandidateInput
    ): Promise<ActivateParameterFileCandidateResult> {
      const response = await client.post<{
        item: ParameterFileCandidate;
        file: ProjectParameterFile;
        version: ProjectParameterFileVersion;
      }>(`${routeCandidate(projectId, candidateId)}/activate`, input);
      return { item: response.item, file: response.file, version: response.version };
    },
    async applyCandidateSourceRevision(projectId, candidateId, input) {
      const response = await client.post<ItemEnvelope<SourceRevisionRequest>>(
        `${routeCandidate(projectId, candidateId)}/source-apply`, input);
      return response.item;
    },
    async getCandidateSourcePreview(projectId: string, candidateId: string) {
      const response = await client.get<ItemEnvelope<ParameterFileSourcePreview>>(
        routeCandidateSourcePreview(projectId, candidateId)
      );
      return response.item;
    },
    async submitCandidateSourceReview(
      projectId: string,
      candidateId: string,
      input: SubmitParameterFileSourceReviewInput
    ) {
      const response = await client.post<ItemEnvelope<ParameterFileSourceReviewResult>>(
        `${routeCandidate(projectId, candidateId)}/source-submit`,
        input
      );
      return response.item;
    },
    async rollbackVersionThroughSourceReview(
      projectId: string,
      fileId: string,
      input: RollbackParameterFileSourceReviewInput
    ) {
      const response = await client.post<ItemEnvelope<ParameterFileSourceReviewResult>>(
        `${routeProjectFiles(projectId)}/${encodeURIComponent(fileId)}/source-rollback`,
        input
      );
      return response.item;
    }
  };
}

export type ParameterFileClient = ReturnType<typeof createParameterFileClient>;
