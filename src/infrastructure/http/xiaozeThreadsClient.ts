import { createDefaultApiClient } from "./defaultApiClient";
import { createApiClient } from "./apiClient";
import { parseContractDto } from "./parseContractDto";
import {
  xiaozeThreadArchiveResponseSchema,
  xiaozeThreadDetailResponseSchema,
  xiaozeThreadListResponseSchema,
  xiaozeThreadPatchResponseSchema
} from "@wiseeff/dto-schemas";

type ApiClient = ReturnType<typeof createApiClient>;

export type XiaozeThreadListItemDto = {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type XiaozeThreadMessageDto = {
  id: string;
  role: "user" | "assistant" | "reasoning" | "system";
  content: string;
  citations?: unknown[];
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type XiaozeThreadDetailDto = {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  context: {
    path?: string;
    pageKey?: string;
    projectId?: string;
    roleId?: string;
  };
  messages: XiaozeThreadMessageDto[];
};

export async function listXiaozeThreads(apiClient: ApiClient = createDefaultApiClient(), limit = 30) {
  const response = parseContractDto(
    xiaozeThreadListResponseSchema,
    await apiClient.get<{ items: XiaozeThreadListItemDto[]; nextCursor: string | null }>(
      `/api/v1/agent/xiaoze/threads?limit=${limit}`
    ),
    "XiaozeThreadListResponse"
  );
  return response.items;
}

export async function getXiaozeThread(threadId: string, apiClient: ApiClient = createDefaultApiClient()) {
  const response = parseContractDto(
    xiaozeThreadDetailResponseSchema,
    await apiClient.get<{ thread: XiaozeThreadDetailDto; messages: XiaozeThreadMessageDto[] }>(
      `/api/v1/agent/xiaoze/threads/${encodeURIComponent(threadId)}`
    ),
    "XiaozeThreadDetailResponse"
  );
  return {
    ...response.thread,
    messages: response.messages
  };
}

export async function patchXiaozeThreadTitle(threadId: string, title: string, apiClient: ApiClient = createDefaultApiClient()) {
  const response = parseContractDto(
    xiaozeThreadPatchResponseSchema,
    await apiClient.patch<{ thread: XiaozeThreadDetailDto }>(
      `/api/v1/agent/xiaoze/threads/${encodeURIComponent(threadId)}`,
      { title }
    ),
    "XiaozeThreadPatchResponse"
  );
  return response.thread;
}

export async function archiveXiaozeThread(threadId: string, apiClient: ApiClient = createDefaultApiClient()) {
  parseContractDto(
    xiaozeThreadArchiveResponseSchema,
    await apiClient.delete<{ ok: boolean }>(`/api/v1/agent/xiaoze/threads/${encodeURIComponent(threadId)}`),
    "XiaozeThreadArchiveResponse"
  );
}
