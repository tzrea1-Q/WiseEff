import type { Database } from "../../../shared/database/client";
import { createParameterModule } from "../../parameters/parameterModuleRepository";

const freeModuleId = async (
  db: Database,
  organizationId: string,
  moduleKind: "driver-group" | "business",
): Promise<string | null> => {
  const result = await db.query<{ id: string }>(
    `select pm.id
       from public.parameter_modules pm
      where pm.organization_id = $1
        and pm.kind = $2
        and not exists (
          select 1 from parameter_catalog.subject_placements sp
           where sp.organization_id = pm.organization_id and sp.module_id = pm.id
        )
      order by case when pm.origin = 'curated' then 0 else 1 end, pm.id
      limit 1`,
    [organizationId, moduleKind],
  );
  return result.rows[0]?.id ?? null;
};

export type SeedPlacementCapacity = {
  readonly driverGroupModuleId: string;
  readonly businessModuleId: string;
  readonly created: readonly string[];
};

/**
 * Operator-curated extra free modules for seed registration. Not called from
 * materializeSeedSources. Creates nothing when a free module of the kind already exists.
 */
export async function curateReviewedSeedPlacementCapacity(
  db: Database,
  input: { readonly organizationId: string },
): Promise<SeedPlacementCapacity> {
  const created: string[] = [];
  let driverGroupModuleId = await freeModuleId(db, input.organizationId, "driver-group");
  if (!driverGroupModuleId) {
    const module = await createParameterModule(db, {
      organizationId: input.organizationId,
      name: "Seed placement capacity",
      kind: "driver-group",
      origin: "curated",
      description: "Reviewed extra driver-group slot for seed subject registration.",
    });
    driverGroupModuleId = module.id;
    created.push(module.id);
  }
  let businessModuleId = await freeModuleId(db, input.organizationId, "business");
  if (!businessModuleId) {
    const module = await createParameterModule(db, {
      organizationId: input.organizationId,
      name: "Seed configuration schema placement",
      kind: "business",
      origin: "curated",
      description: "Reviewed extra business slot for ConfigurationSchema registration.",
    });
    businessModuleId = module.id;
    created.push(module.id);
  }
  return { driverGroupModuleId, businessModuleId, created };
}
