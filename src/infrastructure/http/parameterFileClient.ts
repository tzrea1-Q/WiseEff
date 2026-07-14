import type {
  DownloadParameterFileVersionResult,
  FileSyncSummary,
  ParameterFileConflictResolution,
  ParameterFileRepository,
  ParameterFileSyncConflict,
  ProjectParameterFile,
  ProjectParameterFileVersion,
  UploadParameterFileInput
} from "@/application/ports/ParameterFileRepository";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";

type ItemsEnvelope<T> = { items: T[] };
type ItemEnvelope<T> = { item: T };
type UploadFileEnvelope = { item: ProjectParameterFile; version: ProjectParameterFileVersion };
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

export function createParameterFileClient(client: ApiClient = createDefaultApiClient()): ParameterFileRepository {
  return {
    async listFiles(projectId: string) {
      const response = await client.get<ItemsEnvelope<ProjectParameterFile>>(routeProjectFiles(projectId));
      return response.items;
    },
    async uploadFile(projectId: string, input: UploadParameterFileInput) {
      return client.post<UploadFileEnvelope>(routeProjectFiles(projectId), input);
    },
    async uploadVersion(projectId: string, fileId: string, input: UploadParameterFileInput) {
      const response = await client.post<ItemEnvelope<ProjectParameterFileVersion>>(routeFileVersions(projectId, fileId), input);
      return response.item;
    },
    async listVersions(projectId: string, fileId: string) {
      const response = await client.get<ItemsEnvelope<ProjectParameterFileVersion>>(routeFileVersions(projectId, fileId));
      return response.items;
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
    async listConflicts(projectId: string) {
      const response = await client.get<ItemsEnvelope<ParameterFileSyncConflict>>(routeProjectConflicts(projectId));
      return response.items;
    },
    async resolveConflict(projectId: string, conflictId: string, resolution: ParameterFileConflictResolution) {
      const response = await client.post<ItemEnvelope<ParameterFileSyncConflict>>(routeResolveConflict(projectId, conflictId), { resolution });
      return response.item;
    }
  };
}

export type ParameterFileClient = ReturnType<typeof createParameterFileClient>;
