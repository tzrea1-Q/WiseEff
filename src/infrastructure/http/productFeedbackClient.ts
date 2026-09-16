import type {
  ProductFeedbackDraftCreateInput,
  ProductFeedbackDraftPatchInput,
  ProductFeedbackDraftSubmitInput,
  ProductFeedbackListQuery,
  ProductFeedbackRepository,
  ProductFeedbackSubmitInput
} from "@/application/ports/ProductFeedbackRepository";
import type {
  ProductFeedback,
  ProductFeedbackAttachment,
  ProductFeedbackAttachmentContentType,
  ProductFeedbackProgressEvent,
  ProductFeedbackResolutionCode,
  ProductFeedbackStatus,
  ProductFeedbackType
} from "@/domain/productFeedback/types";
import { createApiClient, WiseEffApiError } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";
import { resolveWiseEffApiBaseUrl } from "./runtimeMode";

type ApiClient = ReturnType<typeof createApiClient>;
type ItemEnvelope<T> = { item: T };
type ListEnvelope<T> = { items: T[]; nextCursor?: string | null };
type HttpProductFeedbackRepositoryOptions =
  | { apiClient?: undefined; baseUrl?: string; fetchImpl?: typeof fetch }
  | { apiClient: ApiClient; baseUrl: string; fetchImpl?: typeof fetch };

export type ProductFeedbackAttachmentDto = {
  id: string;
  feedbackId: string;
  organizationId: string;
  storageKey: string;
  fileName: string;
  contentType: ProductFeedbackAttachmentContentType;
  sizeBytes: number;
  checksum: string;
  sortOrder: number;
  createdAt: string;
};

export type ProductFeedbackDto = {
  id: string;
  organizationId: string;
  submitterUserId: string | null;
  submitter?: { id: string | null; name: string; username: string | null };
  pagePath: string;
  pageTitle: string;
  feedbackType: ProductFeedbackType;
  description: string;
  status: ProductFeedbackStatus;
  resolutionCode?: ProductFeedbackResolutionCode | null;
  adminNote: string | null;
  submittedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: ProductFeedbackAttachmentDto[];
  progressEvents?: ProductFeedbackProgressEvent[];
  latestPublicProgress?: string | null;
};

type ProductFeedbackAttachmentBody = {
  fileName: string;
  contentType: ProductFeedbackAttachmentContentType;
  contentBase64: string;
};

function appendQuery(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function buildProductFeedbackPath(query?: ProductFeedbackListQuery) {
  const params = new URLSearchParams();
  if (query?.status) params.set("status", query.status);
  if (query?.feedbackType) params.set("feedbackType", query.feedbackType);
  if (query?.q) params.set("q", query.q);
  if (query?.pagePath) params.set("pagePath", query.pagePath);
  if (query?.createdFrom) params.set("createdFrom", query.createdFrom);
  if (query?.createdTo) params.set("createdTo", query.createdTo);
  if (query?.cursor) params.set("cursor", query.cursor);
  return appendQuery("/api/v1/product-feedback", params);
}

function routeFeedbackPath(feedbackId: string) {
  return `/api/v1/product-feedback/${encodeURIComponent(feedbackId)}`;
}

function routeAttachmentContentPath(feedbackId: string, attachmentId: string) {
  return `${routeFeedbackPath(feedbackId)}/attachments/${encodeURIComponent(attachmentId)}/content`;
}

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function attachmentFromDto(dto: ProductFeedbackAttachmentDto): ProductFeedbackAttachment {
  return {
    id: dto.id,
    feedbackId: dto.feedbackId,
    fileName: dto.fileName,
    contentType: dto.contentType,
    sizeBytes: dto.sizeBytes,
    sortOrder: dto.sortOrder,
    createdAt: dto.createdAt
  };
}

function productFeedbackFromDto(dto: ProductFeedbackDto): ProductFeedback {
  return {
    id: dto.id,
    submitterUserId: dto.submitterUserId,
    submitter: dto.submitter,
    pagePath: dto.pagePath,
    pageTitle: dto.pageTitle,
    feedbackType: dto.feedbackType,
    description: dto.description,
    status: dto.status,
    resolutionCode: dto.resolutionCode ?? null,
    adminNote: dto.adminNote,
    submittedAt: dto.submittedAt ?? null,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    attachments: dto.attachments.map(attachmentFromDto),
    progressEvents: dto.progressEvents,
    latestPublicProgress: dto.latestPublicProgress ?? null
  };
}

async function attachmentsBody(files: File[]): Promise<ProductFeedbackAttachmentBody[]> {
  return Promise.all(
    files.map(async (file, index) => ({
      fileName: file.name.trim() || `screenshot-${index + 1}.png`,
      contentType: normalizeAttachmentContentType(file.type),
      contentBase64: await fileToBase64(file)
    }))
  );
}

function normalizeAttachmentContentType(type: string): ProductFeedbackAttachmentContentType {
  if (type === "image/jpg") {
    return "image/jpeg";
  }
  if (type === "image/jpeg" || type === "image/webp") {
    return type;
  }
  return "image/png";
}

async function submitBody(input: ProductFeedbackSubmitInput) {
  return {
    pagePath: input.pagePath,
    pageTitle: input.pageTitle,
    feedbackType: input.feedbackType,
    description: input.description,
    ...(input.files.length > 0 ? { attachments: await attachmentsBody(input.files) } : {})
  };
}

function patchBody(patch: { status?: ProductFeedbackStatus; adminNote?: string | null }) {
  return {
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.adminNote !== undefined ? { adminNote: patch.adminNote } : {})
  };
}

function buildMinePath(query?: { cursor?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (query?.cursor) params.set("cursor", query.cursor);
  if (query?.limit) params.set("limit", String(query.limit));
  return appendQuery("/api/v1/product-feedback/mine", params);
}

function routeMineFeedbackPath(feedbackId: string) {
  return `/api/v1/product-feedback/mine/${encodeURIComponent(feedbackId)}`;
}

function routeMineAttachmentContentPath(feedbackId: string, attachmentId: string) {
  return `${routeMineFeedbackPath(feedbackId)}/attachments/${encodeURIComponent(attachmentId)}/content`;
}

function routeDraftPath(draftId: string) {
  return `/api/v1/product-feedback/drafts/${encodeURIComponent(draftId)}`;
}

async function draftCreateBody(input?: ProductFeedbackDraftCreateInput) {
  return {
    ...(input?.pagePath !== undefined ? { pagePath: input.pagePath } : {}),
    ...(input?.pageTitle !== undefined ? { pageTitle: input.pageTitle } : {}),
    ...(input?.feedbackType !== undefined ? { feedbackType: input.feedbackType } : {}),
    ...(input?.description !== undefined ? { description: input.description } : {}),
    ...(input?.files && input.files.length > 0 ? { attachments: await attachmentsBody(input.files) } : {})
  };
}

async function draftPatchBody(input: ProductFeedbackDraftPatchInput) {
  return {
    ...(input.pagePath !== undefined ? { pagePath: input.pagePath } : {}),
    ...(input.pageTitle !== undefined ? { pageTitle: input.pageTitle } : {}),
    ...(input.feedbackType !== undefined ? { feedbackType: input.feedbackType } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.retainedAttachmentIds !== undefined ? { retainedAttachmentIds: input.retainedAttachmentIds } : {}),
    ...(input.newFiles && input.newFiles.length > 0 ? { newAttachments: await attachmentsBody(input.newFiles) } : {})
  };
}

export function createHttpProductFeedbackRepository(
  options: HttpProductFeedbackRepositoryOptions = {}
): ProductFeedbackRepository {
  const baseUrl = options.baseUrl ?? resolveWiseEffApiBaseUrl();
  const apiClient = options.apiClient ?? createDefaultApiClient({ baseUrl, fetchImpl: options.fetchImpl });

  return {
    async submit(input) {
      const response = await apiClient.post<ItemEnvelope<ProductFeedbackDto>>("/api/v1/product-feedback", await submitBody(input));
      return productFeedbackFromDto(response.item);
    },
    async list(query) {
      const response = await apiClient.get<ListEnvelope<ProductFeedbackDto>>(buildProductFeedbackPath(query));
      return {
        items: response.items.map(productFeedbackFromDto),
        ...(response.nextCursor ? { nextCursor: response.nextCursor } : {})
      };
    },
    async get(id) {
      try {
        const response = await apiClient.get<ItemEnvelope<ProductFeedbackDto>>(routeFeedbackPath(id));
        return productFeedbackFromDto(response.item);
      } catch (error) {
        if (error instanceof WiseEffApiError && error.code === "NOT_FOUND") {
          return null;
        }
        throw error;
      }
    },
    async update(id, patch) {
      const response = await apiClient.patch<ItemEnvelope<ProductFeedbackDto>>(routeFeedbackPath(id), patchBody(patch));
      return productFeedbackFromDto(response.item);
    },
    async getAttachmentObjectUrl(feedbackId, attachmentId) {
      const response = await apiClient.raw(routeAttachmentContentPath(feedbackId, attachmentId), {
        method: "GET",
        headers: { Accept: "image/*" }
      });
      return URL.createObjectURL(await response.blob());
    },
    async createDraft(input) {
      const response = await apiClient.post<ItemEnvelope<ProductFeedbackDto>>(
        "/api/v1/product-feedback/drafts",
        await draftCreateBody(input)
      );
      return productFeedbackFromDto(response.item);
    },
    async saveDraft(id, input) {
      const response = await apiClient.patch<ItemEnvelope<ProductFeedbackDto>>(
        routeDraftPath(id),
        await draftPatchBody(input)
      );
      return productFeedbackFromDto(response.item);
    },
    async deleteDraft(id) {
      return apiClient.delete<{ ok: boolean }>(routeDraftPath(id));
    },
    async submitDraft(id, input?: ProductFeedbackDraftSubmitInput) {
      const response = await apiClient.post<ItemEnvelope<ProductFeedbackDto>>(
        `${routeDraftPath(id)}/submit`,
        input ?? {}
      );
      return productFeedbackFromDto(response.item);
    },
    async listMine(query) {
      const response = await apiClient.get<ListEnvelope<ProductFeedbackDto>>(buildMinePath(query));
      return {
        items: response.items.map(productFeedbackFromDto),
        ...(response.nextCursor ? { nextCursor: response.nextCursor } : {})
      };
    },
    async getMine(id) {
      try {
        const response = await apiClient.get<ItemEnvelope<ProductFeedbackDto>>(routeMineFeedbackPath(id));
        return productFeedbackFromDto(response.item);
      } catch (error) {
        if (error instanceof WiseEffApiError && error.code === "NOT_FOUND") {
          return null;
        }
        throw error;
      }
    },
    async getMineAttachmentObjectUrl(feedbackId, attachmentId) {
      const response = await apiClient.raw(routeMineAttachmentContentPath(feedbackId, attachmentId), {
        method: "GET",
        headers: { Accept: "image/*" }
      });
      return URL.createObjectURL(await response.blob());
    }
  };
}
