import type { ParameterInitializationRepository } from "@/application/ports/ParameterInitializationRepository";
import type {
  InitializationDraftDto,
  InitializationReviewDto,
  ProjectInitializationStatus,
  SemanticInitializationSnapshotItem
} from "@/domain/parameters/initializationTypes";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";

type ApiClient = ReturnType<typeof createApiClient>;
type ItemEnvelope<T> = { item: T };
type ItemsEnvelope<T> = { items: T[] };

function projectPath(projectId: string, suffix = "") {
  return `/api/v1/parameters/projects/${encodeURIComponent(projectId)}/initialization${suffix}`;
}

function reviewPath(reviewId: string, action: "approve" | "reject") {
  return `/api/v1/parameters/admin/initialization-reviews/${encodeURIComponent(reviewId)}/${action}`;
}

export function createHttpParameterInitializationRepository(
  apiClient: ApiClient = createDefaultApiClient()
): ParameterInitializationRepository {
  return {
    async getInitialization(projectId) {
      return apiClient.get<{ status: ProjectInitializationStatus; draft: InitializationDraftDto | null }>(
        projectPath(projectId)
      );
    },
    async upsertDraft(input) {
      const { projectId, ...body } = input;
      const response = await apiClient.put<ItemEnvelope<InitializationDraftDto>>(projectPath(projectId, "/draft"), body);
      return response.item;
    },
    async previewSnapshot(input) {
      const { projectId, ...body } = input;
      const response = await apiClient.post<ItemsEnvelope<SemanticInitializationSnapshotItem>>(
        projectPath(projectId, "/preview"),
        body
      );
      return response.items;
    },
    async submit(projectId) {
      const response = await apiClient.post<ItemEnvelope<InitializationReviewDto>>(
        projectPath(projectId, "/submit"),
        {}
      );
      return response.item;
    },
    async listPendingReviews() {
      const response = await apiClient.get<ItemsEnvelope<InitializationReviewDto>>(
        "/api/v1/parameters/admin/initialization-reviews"
      );
      return response.items;
    },
    async approve(reviewId) {
      const response = await apiClient.post<ItemEnvelope<InitializationReviewDto>>(
        reviewPath(reviewId, "approve"),
        {}
      );
      return response.item;
    },
    async reject(reviewId, reason) {
      const response = await apiClient.post<ItemEnvelope<InitializationReviewDto>>(reviewPath(reviewId, "reject"), {
        reason
      });
      return response.item;
    }
  };
}

export type ParameterInitializationClient = ReturnType<typeof createHttpParameterInitializationRepository>;
