import type { Database } from "../../../shared/database/client";
import { createParameterModule } from "../../parameters/parameterModuleRepository";
import { lockOrganizationModuleStructure } from "../../parameter-modules/recognitionLock";

/** Ensure the seed has a deterministic business or unclassified destination. */
export async function curateReviewedSeedPlacementCapacity(
  db: Database,
  input: { readonly organizationId: string },
): Promise<{ readonly businessModuleId: string; readonly created: readonly string[] }> {
  return db.transaction(async tx => {
    await lockOrganizationModuleStructure(tx, input.organizationId);
    const existing = await tx.query<{ id: string }>(
      `select id from public.parameter_modules
       where organization_id = $1 and (kind = 'business' or (kind = 'unclassified' and parent_id is null))
       order by case when origin = 'curated' then 0 else 1 end,
         coalesce(source_key, name) collate "C", name collate "C", id limit 1`,
      [input.organizationId],
    );
    if (existing.rows[0]) return { businessModuleId: existing.rows[0].id, created: [] };
    const module = await createParameterModule(tx, {
      organizationId: input.organizationId,
      name: "Seed configuration schema placement",
      kind: "business",
      origin: "curated",
      description: "Business category for seed subject registration.",
    });
    return { businessModuleId: module.id, created: [module.id] };
  });
}
