import type {
  DriverSchemaPromotionRepository,
  PromotionCandidate,
} from "@/application/ports/DriverSchemaPromotionRepository";

type PromotionStore = {
  candidates: PromotionCandidate[];
  promotions: Map<string, { platformSchemaId: string; restored: boolean }>;
};

function defaultStore(): PromotionStore {
  return { candidates: [], promotions: new Map() };
}

let store = defaultStore();

export function resetMockDriverSchemaPromotionStore() {
  store = defaultStore();
}

export function seedMockDriverSchemaPromotionCandidates(candidates: PromotionCandidate[]) {
  store.candidates = candidates;
}

export function createMockDriverSchemaPromotionRepository(): DriverSchemaPromotionRepository {
  return {
    async listPromotionCandidates() {
      return { items: store.candidates };
    },
    async promoteDriverSchemaOverlay(input) {
      const candidate = store.candidates.find(
        (entry) => entry.compatible.toLowerCase() === input.compatible.toLowerCase(),
      );
      if (!candidate || !candidate.equivalent) {
        throw new Error("Contributors are not equivalent for promotion.");
      }
      const platformSchemaId = `platform-overlay-mock-${input.compatible}`;
      const promotionIds = candidate.contributorOrganizationIds.map(
        (orgId, index) => `promotion-mock-${index}-${orgId}`,
      );
      for (const id of promotionIds) {
        store.promotions.set(id, { platformSchemaId, restored: false });
      }
      const updated = store.candidates.find(
        (entry) => entry.compatible.toLowerCase() === input.compatible.toLowerCase(),
      );
      if (updated) {
        updated.hasActivePlatformOverlay = true;
        updated.platformSchemaId = platformSchemaId;
        updated.promotionIds = promotionIds;
      }
      return {
        promotionIds,
        platformSchemaId,
        supersededSchemaIds: candidate.contributors.map((entry) => entry.schemaId),
        affectedOrganizationIds: candidate.contributorOrganizationIds,
      };
    },
    async revertDriverSchemaPromotion(promotionId) {
      const promotion = store.promotions.get(promotionId);
      if (!promotion || promotion.restored) {
        throw new Error("Promotion record not found.");
      }
      promotion.restored = true;
      const candidate = store.candidates.find(
        (entry) => entry.platformSchemaId === promotion.platformSchemaId,
      );
      if (candidate) {
        candidate.hasActivePlatformOverlay = false;
        candidate.platformSchemaId = undefined;
        candidate.promotionIds = undefined;
      }
      return {
        platformSchemaId: promotion.platformSchemaId,
        restoredSchemaIds: candidate?.contributors.map((entry) => entry.schemaId) ?? [],
        affectedOrganizationIds: candidate?.contributorOrganizationIds ?? [],
      };
    },
  };
}
