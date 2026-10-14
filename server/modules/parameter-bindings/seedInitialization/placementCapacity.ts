import type { Database } from "../../../shared/database/client";
import { adoptParameterModuleSourceKey, createParameterModule, getParameterModuleByName, getParameterModuleBySourceKey, updateParameterModule } from "../../parameters/parameterModuleRepository";

const DRIVER_CAPACITY_KEY = "seed-placement-capacity:driver-group";
const DRIVER_CAPACITY_NAME = "默认驱动分组";

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
      order by case when pm.origin = 'curated' then 0 else 1 end,
               coalesce(pm.source_key, pm.name) collate "C", pm.name collate "C", pm.id
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
 * Operator-curated capacity for the reviewed seed. Not called from
 * materializeSeedSources. The driver slot is additional to source-discovered
 * modules: those may be free before ingest but are already needed by the seed.
 * This is one fixed reserve, not a new free slot on each call; reuse it after
 * registration too. The materializer still checks capacity for every subject.
 */
export async function curateReviewedSeedPlacementCapacity(
  db: Database,
  input: { readonly organizationId: string },
): Promise<SeedPlacementCapacity> {
  const created: string[] = [];
  const reserved = await getParameterModuleBySourceKey(db, {
    organizationId: input.organizationId, sourceKey: DRIVER_CAPACITY_KEY,
  }) ?? await getParameterModuleByName(db, {
    // Earlier operators created this reviewed slot without a source key.
    organizationId: input.organizationId, name: "Seed placement capacity",
  });
  if (reserved && (reserved.kind !== "driver-group" || reserved.origin !== "curated"
    || (reserved.sourceKey !== null && reserved.sourceKey !== DRIVER_CAPACITY_KEY))) {
    throw new Error("seed-rebuild-placement-capacity-conflict");
  }
  if (reserved && reserved.sourceKey === null) {
    await adoptParameterModuleSourceKey(db, {
      organizationId: input.organizationId, moduleId: reserved.id, sourceKey: DRIVER_CAPACITY_KEY,
    });
  }
  if (reserved?.name === "Seed placement capacity") {
    await updateParameterModule(db, {
      organizationId: input.organizationId, moduleId: reserved.id, name: DRIVER_CAPACITY_NAME,
    });
  }
  let driverGroupModuleId = reserved?.id ?? null;
  if (!driverGroupModuleId) {
    const module = await createParameterModule(db, {
      organizationId: input.organizationId,
      name: DRIVER_CAPACITY_NAME,
      kind: "driver-group",
      origin: "curated",
      sourceKey: DRIVER_CAPACITY_KEY,
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
