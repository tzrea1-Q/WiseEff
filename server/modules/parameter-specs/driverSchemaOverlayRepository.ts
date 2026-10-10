import type { Queryable } from "../../shared/database/client";

export type DriverSchemaOverlayPromotionRow = {
  id: string;
  platform_schema_id: string;
  source_schema_id: string;
  source_organization_id: string;
  promoted_by_user_id: string | null;
  promoted_at: string;
  documentation_source: string | null;
};

export async function listDriverSchemaPromotions(
  db: Queryable,
  platformSchemaId?: string,
): Promise<DriverSchemaOverlayPromotionRow[]> {
  const result = await db.query<DriverSchemaOverlayPromotionRow>(
    `
    select id, platform_schema_id, source_schema_id, source_organization_id,
           promoted_by_user_id, promoted_at::text, documentation_source
    from driver_schema_overlay_promotions
    where ($1::text is null or platform_schema_id = $1)
    order by promoted_at desc, id asc
    `,
    [platformSchemaId ?? null],
  );
  return result.rows;
}
