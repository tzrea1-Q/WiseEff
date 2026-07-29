export type PromotionContributorProjection = {
  organizationId: string;
  schemaId: string;
  propertyKeys: string[];
  properties: Array<{
    propertyKey: string;
    valueShapeKind: string;
    units: string | null;
  }>;
  documentationByKey: Record<string, string>;
};

export type PromotionCandidate = {
  compatible: string;
  contributorOrganizationIds: string[];
  contributorCount: number;
  propertyKeys: string[];
  contributors: PromotionContributorProjection[];
  equivalent: boolean;
  divergence?: Array<{
    propertyKey: string;
    contributors: Array<{
      organizationId: string;
      valueShapeKind: string;
      units: string | null;
    }>;
  }>;
  hasActivePlatformOverlay: boolean;
  platformSchemaId?: string;
  promotionIds?: string[];
};

export type PromoteDriverSchemaOverlayInput = {
  compatible: string;
  displayName?: string;
  notes?: string;
  documentationSourceOrganizationId?: string;
};

export type PromoteDriverSchemaOverlayResult = {
  promotionIds: string[];
  platformSchemaId: string;
  supersededSchemaIds: string[];
  affectedOrganizationIds: string[];
};

export type RevertDriverSchemaPromotionResult = {
  platformSchemaId: string;
  restoredSchemaIds: string[];
  affectedOrganizationIds: string[];
};

export interface DriverSchemaPromotionRepository {
  listPromotionCandidates(): Promise<{ items: PromotionCandidate[] }>;
  promoteDriverSchemaOverlay(
    input: PromoteDriverSchemaOverlayInput
  ): Promise<PromoteDriverSchemaOverlayResult>;
  revertDriverSchemaPromotion(promotionId: string): Promise<RevertDriverSchemaPromotionResult>;
}
