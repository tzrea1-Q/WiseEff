import type {
  ProductFeedbackListQuery,
  ProductFeedbackRepository,
  ProductFeedbackSubmitInput
} from "@/application/ports/ProductFeedbackRepository";
import type {
  ProductFeedback,
  ProductFeedbackAttachment,
  ProductFeedbackAttachmentContentType,
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
  submitterUserId: string;
  pagePath: string;
  pageTitle: string;
  feedbackType: ProductFeedbackType;
  description: string;
  status: ProductFeedbackStatus;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: ProductFeedbackAttachmentDto[];
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
    pagePath: dto.pagePath,
    pageTitle: dto.pageTitle,
    feedbackType: dto.feedbackType,
    description: dto.description,
    status: dto.status,
    adminNote: dto.adminNote,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    attachments: dto.attachments.map(attachmentFromDto)
  };
}

async function attachmentsBody(files: File[]): Promise<ProductFeedbackAttachmentBody[]> {
  return Promise.all(
    files.map(async (file) => ({
      fileName: file.name,
      contentType: (file.type || "image/png") as ProductFeedbackAttachmentContentType,
      contentBase64: await fileToBase64(file)
    }))
  );
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
    }
  };
}
