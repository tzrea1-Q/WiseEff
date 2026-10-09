import type {
  DriverSchemaPromotionHistoryItem,
  DriverSchemaPromotionRepository,
} from "@/application/ports/DriverSchemaPromotionRepository";

let history: DriverSchemaPromotionHistoryItem[] = [];

export function resetMockDriverSchemaPromotionStore() {
  history = [];
}

export function seedMockDriverSchemaPromotionHistory(items: DriverSchemaPromotionHistoryItem[]) {
  history = structuredClone(items);
}

export function createMockDriverSchemaPromotionRepository(): DriverSchemaPromotionRepository {
  return {
    async listPromotionHistory() {
      return { items: structuredClone(history) };
    },
  };
}
