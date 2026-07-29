import type { DriverSchemaPromotionRepository } from "@/application/ports/DriverSchemaPromotionRepository";
import { createDefaultDriverSchemaPromotionClient } from "@/infrastructure/http/driverSchemaPromotionClient";
import { wiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { createMockDriverSchemaPromotionRepository } from "@/infrastructure/mock/mockDriverSchemaPromotionRepository";

export function resolveDriverSchemaPromotionRepository(
  mode?: string,
): DriverSchemaPromotionRepository {
  const runtimeMode = mode ?? wiseEffRuntimeMode;
  if (runtimeMode === "mock") {
    return createMockDriverSchemaPromotionRepository();
  }
  return createDefaultDriverSchemaPromotionClient();
}
