import type {
  DriverSchemaPromotionRepository,
  PromoteDriverSchemaOverlayInput,
  PromoteDriverSchemaOverlayResult,
  PromotionCandidate,
  RevertDriverSchemaPromotionResult,
} from "@/application/ports/DriverSchemaPromotionRepository";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";

type ApiClient = ReturnType<typeof createApiClient>;

const BASE = "/api/v2/platform/driver-schemas";

export function createDriverSchemaPromotionClient(apiClient: ApiClient): DriverSchemaPromotionRepository {
  return {
    async listPromotionCandidates(): Promise<{ items: PromotionCandidate[] }> {
      return apiClient.get<{ items: PromotionCandidate[] }>(`${BASE}/promotion-candidates`);
    },
    async promoteDriverSchemaOverlay(
      input: PromoteDriverSchemaOverlayInput,
    ): Promise<PromoteDriverSchemaOverlayResult> {
      return apiClient.post<PromoteDriverSchemaOverlayResult>(`${BASE}/promotions`, input);
    },
    async revertDriverSchemaPromotion(promotionId: string): Promise<RevertDriverSchemaPromotionResult> {
      return apiClient.post<RevertDriverSchemaPromotionResult>(
        `${BASE}/promotions/${encodeURIComponent(promotionId)}/revert`,
        {},
      );
    },
  };
}

export function createDefaultDriverSchemaPromotionClient(): DriverSchemaPromotionRepository {
  return createDriverSchemaPromotionClient(createDefaultApiClient());
}
