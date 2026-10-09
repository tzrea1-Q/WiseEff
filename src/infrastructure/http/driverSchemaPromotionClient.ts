import type { DriverSchemaPromotionRepository } from "@/application/ports/DriverSchemaPromotionRepository";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";

type ApiClient = ReturnType<typeof createApiClient>;

export function createDriverSchemaPromotionClient(apiClient: ApiClient): DriverSchemaPromotionRepository {
  return {
    listPromotionHistory: () => apiClient.get("/api/v2/platform/driver-schema-promotion-history"),
  };
}

export function createDefaultDriverSchemaPromotionClient(): DriverSchemaPromotionRepository {
  return createDriverSchemaPromotionClient(createDefaultApiClient());
}
