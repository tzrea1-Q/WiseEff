import type {
  CreateFileKnowledgeInput,
  CreateMarkdownKnowledgeInput,
  KnowledgeListQuery,
  KnowledgeRepository,
  UpdateKnowledgeInput
} from "@/application/ports/KnowledgeRepository";
import { KnowledgeRevisionConflictError } from "@/application/ports/KnowledgeRepository";
import type {
  KnowledgeContentForm,
  KnowledgeEntry,
  KnowledgeExtractionStatus,
  KnowledgeIndexHealth,
  KnowledgeParameterReference,
  KnowledgeRetrievalInfo,
  KnowledgeRevision,
  KnowledgeSearchResult,
  KnowledgeSourceType,
  KnowledgeStatus
} from "@/domain/knowledge/types";
import { createApiClient, WiseEffApiError } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";
import { resolveWiseEffApiBaseUrl } from "./runtimeMode";

type ApiClient = ReturnType<typeof createApiClient>;
type ItemEnvelope<T> = { item: T };
type ListEnvelope<T> = { items: T[] };
type HttpKnowledgeRepositoryOptions =
  | { apiClient?: undefined; baseUrl?: string; fetchImpl?: typeof fetch }
  | { apiClient: ApiClient; baseUrl: string; fetchImpl?: typeof fetch };

export type KnowledgeFileDto = {
  id: string;
  entryId: string;
  organizationId: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  extractionStatus: KnowledgeExtractionStatus;
  extractionError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeParameterReferenceDto = {
  specId: string;
  propertyKey: string;
  displayName: string | null;
  driverModule: string | null;
  lifecycle: KnowledgeParameterReference["lifecycle"];
  createdByUserId: string;
  createdAt: string;
};

export type KnowledgeEntryDto = {
  id: string;
  organizationId: string;
  title: string;
  contentForm: KnowledgeContentForm;
  status: KnowledgeStatus;
  tags: string[];
  sourceType: KnowledgeSourceType;
  sourceSessionId: string | null;
  sourceLogId: string | null;
  createdByUserId: string;
  headRevisionId: string | null;
  headRevisionNumber: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  contentMarkdown: string | null;
  file: KnowledgeFileDto | null;
  parameterReferences: KnowledgeParameterReferenceDto[];
};

export type KnowledgeRevisionDto = {
  id: string;
  entryId: string;
  organizationId: string;
  revisionNumber: number;
  title: string;
  tags: string[];
  contentMarkdown: string | null;
  fileId: string | null;
  authorUserId: string;
  restoredFromRevisionId: string | null;
  createdAt: string;
};

const KNOWLEDGE_FILE_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/markdown"
]);

function entryPath(entryId: string) {
  return `/api/v1/knowledge/entries/${encodeURIComponent(entryId)}`;
}

function entryFromDto(dto: KnowledgeEntryDto): KnowledgeEntry {
  return {
    id: dto.id,
    title: dto.title,
    contentForm: dto.contentForm,
    status: dto.status,
    tags: dto.tags,
    sourceType: dto.sourceType,
    sourceSessionId: dto.sourceSessionId,
    sourceLogId: dto.sourceLogId,
    createdByUserId: dto.createdByUserId,
    headRevisionNumber: dto.headRevisionNumber,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    publishedAt: dto.publishedAt,
    archivedAt: dto.archivedAt,
    contentMarkdown: dto.contentMarkdown,
    file: dto.file
      ? {
          id: dto.file.id,
          fileName: dto.file.fileName,
          contentType: dto.file.contentType,
          sizeBytes: dto.file.sizeBytes,
          extractionStatus: dto.file.extractionStatus,
          extractionError: dto.file.extractionError,
          createdAt: dto.file.createdAt
        }
      : null,
    parameterReferences: (dto.parameterReferences ?? []).map((reference) => ({
      specId: reference.specId,
      propertyKey: reference.propertyKey,
      displayName: reference.displayName,
      driverModule: reference.driverModule,
      lifecycle: reference.lifecycle,
      createdByUserId: reference.createdByUserId,
      createdAt: reference.createdAt
    }))
  };
}

function revisionFromDto(dto: KnowledgeRevisionDto): KnowledgeRevision {
  return {
    id: dto.id,
    entryId: dto.entryId,
    revisionNumber: dto.revisionNumber,
    title: dto.title,
    tags: dto.tags,
    contentMarkdown: dto.contentMarkdown,
    fileId: dto.fileId,
    authorUserId: dto.authorUserId,
    restoredFromRevisionId: dto.restoredFromRevisionId,
    createdAt: dto.createdAt
  };
}

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function normalizeKnowledgeFileContentType(file: File): string {
  if (KNOWLEDGE_FILE_CONTENT_TYPES.has(file.type)) {
    return file.type;
  }
  const name = file.name.toLocaleLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".doc")) return "application/msword";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "text/markdown";
  return "text/plain";
}

async function fileBody(file: File) {
  return {
    fileName: file.name,
    contentType: normalizeKnowledgeFileContentType(file),
    contentBase64: await fileToBase64(file)
  };
}

function buildListPath(query?: KnowledgeListQuery) {
  const params = new URLSearchParams();
  if (query?.status) params.set("status", query.status);
  if (query?.contentForm) params.set("contentForm", query.contentForm);
  if (query?.sourceType) params.set("sourceType", query.sourceType);
  if (query?.tag) params.set("tag", query.tag);
  if (query?.q) params.set("q", query.q);
  const encoded = params.toString();
  return encoded ? `/api/v1/knowledge/entries?${encoded}` : "/api/v1/knowledge/entries";
}

function translateConflict(error: unknown): never {
  if (error instanceof WiseEffApiError && error.code === "CONFLICT") {
    const details = error.details as {
      expectedHeadRevisionNumber?: number;
      currentHeadRevisionNumber?: number;
    };
    throw new KnowledgeRevisionConflictError(
      error.message,
      details.expectedHeadRevisionNumber ?? 0,
      details.currentHeadRevisionNumber ?? 0
    );
  }
  throw error;
}

export function createHttpKnowledgeRepository(options: HttpKnowledgeRepositoryOptions = {}): KnowledgeRepository {
  const baseUrl = options.baseUrl ?? resolveWiseEffApiBaseUrl();
  const apiClient = options.apiClient ?? createDefaultApiClient({ baseUrl, fetchImpl: options.fetchImpl });

  return {
    async list(query) {
      const response = await apiClient.get<ListEnvelope<KnowledgeEntryDto>>(buildListPath(query));
      return { items: response.items.map(entryFromDto) };
    },

    async get(entryId) {
      try {
        const response = await apiClient.get<ItemEnvelope<KnowledgeEntryDto>>(entryPath(entryId));
        return entryFromDto(response.item);
      } catch (error) {
        if (error instanceof WiseEffApiError && error.code === "NOT_FOUND") {
          return null;
        }
        throw error;
      }
    },

    async createMarkdown(input: CreateMarkdownKnowledgeInput) {
      const response = await apiClient.post<ItemEnvelope<KnowledgeEntryDto>>("/api/v1/knowledge/entries", {
        contentForm: "markdown",
        title: input.title,
        tags: input.tags,
        contentMarkdown: input.contentMarkdown
      });
      return entryFromDto(response.item);
    },

    async createFile(input: CreateFileKnowledgeInput) {
      const response = await apiClient.post<ItemEnvelope<KnowledgeEntryDto>>("/api/v1/knowledge/entries", {
        contentForm: "file",
        title: input.title,
        tags: input.tags,
        file: await fileBody(input.file)
      });
      return entryFromDto(response.item);
    },

    async distillFromLog(logId) {
      const response = await apiClient.post<ItemEnvelope<KnowledgeEntryDto>>("/api/v1/knowledge/distill-from-log", {
        logId
      });
      return entryFromDto(response.item);
    },

    async update(entryId, input: UpdateKnowledgeInput) {
      try {
        const response = await apiClient.patch<ItemEnvelope<KnowledgeEntryDto>>(entryPath(entryId), {
          expectedHeadRevisionNumber: input.expectedHeadRevisionNumber,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.contentMarkdown !== undefined ? { contentMarkdown: input.contentMarkdown } : {}),
          ...(input.file ? { file: await fileBody(input.file) } : {})
        });
        return entryFromDto(response.item);
      } catch (error) {
        translateConflict(error);
      }
    },

    async publish(entryId) {
      const response = await apiClient.post<ItemEnvelope<KnowledgeEntryDto>>(`${entryPath(entryId)}/publish`, {});
      return entryFromDto(response.item);
    },

    async archive(entryId) {
      const response = await apiClient.post<ItemEnvelope<KnowledgeEntryDto>>(`${entryPath(entryId)}/archive`, {});
      return entryFromDto(response.item);
    },

    async restore(entryId) {
      const response = await apiClient.post<ItemEnvelope<KnowledgeEntryDto>>(`${entryPath(entryId)}/restore`, {});
      return entryFromDto(response.item);
    },

    async rejectAgentDraft(entryId) {
      const response = await apiClient.post<ItemEnvelope<KnowledgeEntryDto>>(`${entryPath(entryId)}/reject`, {});
      return entryFromDto(response.item);
    },

    async hardDelete(entryId) {
      await apiClient.delete<{ deleted: boolean }>(entryPath(entryId));
    },

    async listRevisions(entryId) {
      const response = await apiClient.get<ListEnvelope<KnowledgeRevisionDto>>(`${entryPath(entryId)}/revisions`);
      return response.items.map(revisionFromDto);
    },

    async restoreRevision(entryId, revisionId, expectedHeadRevisionNumber) {
      try {
        const response = await apiClient.post<ItemEnvelope<KnowledgeEntryDto>>(
          `${entryPath(entryId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
          { expectedHeadRevisionNumber }
        );
        return entryFromDto(response.item);
      } catch (error) {
        translateConflict(error);
      }
    },

    async search(q) {
      const params = new URLSearchParams({ q });
      const response = await apiClient.get<ListEnvelope<KnowledgeSearchResult> & { retrieval: KnowledgeRetrievalInfo }>(
        `/api/v1/knowledge/search?${params.toString()}`
      );
      return { items: response.items, retrieval: response.retrieval };
    },

    async relatedToLog(logId) {
      const params = new URLSearchParams({ logId });
      const response = await apiClient.get<ListEnvelope<KnowledgeSearchResult> & { retrieval: KnowledgeRetrievalInfo }>(
        `/api/v1/knowledge/related-to-log?${params.toString()}`
      );
      return { items: response.items, retrieval: response.retrieval };
    },

    async relatedToSpec(specId) {
      const params = new URLSearchParams({ specId });
      const response = await apiClient.get<ListEnvelope<KnowledgeSearchResult>>(
        `/api/v1/knowledge/related-to-spec?${params.toString()}`
      );
      return { items: response.items };
    },

    async addParameterReference(entryId, specId) {
      const response = await apiClient.put<ItemEnvelope<KnowledgeEntryDto>>(
        `${entryPath(entryId)}/parameter-references/${encodeURIComponent(specId)}`,
        {}
      );
      return entryFromDto(response.item);
    },

    async removeParameterReference(entryId, specId) {
      const response = await apiClient.delete<ItemEnvelope<KnowledgeEntryDto>>(
        `${entryPath(entryId)}/parameter-references/${encodeURIComponent(specId)}`
      );
      return entryFromDto(response.item);
    },

    async getFileObjectUrl(entryId) {
      const response = await apiClient.raw(`${entryPath(entryId)}/file/content`, {
        method: "GET",
        headers: { Accept: "*/*" }
      });
      return URL.createObjectURL(await response.blob());
    },

    async getIndexHealth() {
      return apiClient.get<KnowledgeIndexHealth>("/api/v1/knowledge/index/status");
    },

    async retryEntryIndex(entryId) {
      await apiClient.post<{ enqueued: boolean }>(`${entryPath(entryId)}/index/retry`, {});
    },

    async rebuildIndex() {
      return apiClient.post<{ enqueued: number }>("/api/v1/knowledge/index/rebuild", {});
    }
  };
}
