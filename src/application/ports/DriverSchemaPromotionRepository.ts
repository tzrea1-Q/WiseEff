export type DriverSchemaPromotionHistoryItem = {
  id: string;
  platformSchemaId: string;
  sourceSchemaId: string;
  sourceOrganizationId: string;
  promotedByUserId: string | null;
  promotedAt: string;
  documentationSource: string | null;
};

export interface DriverSchemaPromotionRepository {
  listPromotionHistory(): Promise<{ items: DriverSchemaPromotionHistoryItem[] }>;
}
