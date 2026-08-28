import { createHash } from "node:crypto";

import type { Queryable } from "../../shared/database/client";

export type DriverRegistrationPlacement = {
  id: string;
  organizationId: string;
  attributionSubjectId: string;
  driverGroupModuleId: string;
  defaultBusinessCategoryModuleId: string | null;
};

type PlacementRow = {
  id: string;
  organization_id: string;
  attribution_subject_id: string;
  driver_group_module_id: string;
  default_business_category_module_id: string | null;
};

function toPlacement(row: PlacementRow): DriverRegistrationPlacement {
  return {
    id: row.id,
    organizationId: row.organization_id,
    attributionSubjectId: row.attribution_subject_id,
    driverGroupModuleId: row.driver_group_module_id,
    defaultBusinessCategoryModuleId: row.default_business_category_module_id,
  };
}

export async function getDriverRegistrationPlacement(
  db: Queryable,
  input: { organizationId: string; attributionSubjectId: string },
): Promise<DriverRegistrationPlacement | null> {
  const result = await db.query<PlacementRow>(
    `
    select drp.id, drp.organization_id, drp.attribution_subject_id,
           drp.driver_group_module_id, drp.default_business_category_module_id
    from driver_registration_placements drp
    inner join attribution_subjects asub
      on asub.id = drp.attribution_subject_id
     and asub.subject_kind = 'driver-registration'
    inner join driver_registrations dr
      on dr.attribution_subject_id = drp.attribution_subject_id
    inner join parameter_modules dgm
      on dgm.id = drp.driver_group_module_id
     and dgm.organization_id = drp.organization_id
     and dgm.kind = 'driver-group'
     and dgm.attribution_subject_id = drp.attribution_subject_id
    left join parameter_modules category
      on category.id = drp.default_business_category_module_id
    where drp.organization_id = $1
      and drp.attribution_subject_id = $2
      and (
        drp.default_business_category_module_id is null
        or (
          category.organization_id = drp.organization_id
          and category.kind = 'business'
        )
      )
    limit 1
    `,
    [input.organizationId, input.attributionSubjectId],
  );
  return result.rows[0] ? toPlacement(result.rows[0]) : null;
}

/**
 * Ensure the declared organization placement for a canonical registration.
 * Existing placement is authoritative and is never silently replaced by an
 * observed module. A missing module/category returns null for governance.
 */
export async function ensureDriverRegistrationPlacement(
  db: Queryable,
  input: {
    organizationId: string;
    attributionSubjectId: string;
    driverGroupModuleId?: string | null;
    defaultBusinessCategoryModuleId?: string | null;
  },
): Promise<DriverRegistrationPlacement | null> {
  const existing = await getDriverRegistrationPlacement(db, input);
  if (existing) return existing;

  const moduleResult = input.driverGroupModuleId
    ? await db.query<{ id: string }>(
        `
        select id from parameter_modules
        where id = $1 and organization_id = $2 and kind = 'driver-group'
          and attribution_subject_id = $3
        limit 1
        `,
        [input.driverGroupModuleId, input.organizationId, input.attributionSubjectId],
      )
    : await db.query<{ id: string }>(
        `
        select id
        from parameter_modules
        where organization_id = $1
          and kind = 'driver-group'
          and attribution_subject_id = $2
        order by case when origin = 'curated' then 0 else 1 end, id
        limit 2
        `,
        [input.organizationId, input.attributionSubjectId],
      );
  if (!input.driverGroupModuleId && moduleResult.rows.length !== 1) {
    // Multiple modules for one registration are exactly the ambiguity this
    // placement row is meant to remove. Do not pick by id and make the
    // effective catalog appear healthy; leave it for reconciliation/governance.
    return null;
  }
  const moduleId = moduleResult.rows[0]?.id;
  if (!moduleId) return null;

  let defaultBusinessCategoryModuleId = input.defaultBusinessCategoryModuleId ?? null;
  if (!defaultBusinessCategoryModuleId) {
    const parent = await db.query<{ parent_id: string | null }>(
      `select parent_id from parameter_modules where id = $1 limit 1`,
      [moduleId],
    );
    defaultBusinessCategoryModuleId = parent.rows[0]?.parent_id ?? null;
  }

  if (defaultBusinessCategoryModuleId) {
    const category = await db.query<{ id: string }>(
      `
      select id from parameter_modules
      where id = $1 and organization_id = $2 and kind = 'business'
      limit 1
      `,
      [defaultBusinessCategoryModuleId, input.organizationId],
    );
    if (!category.rows[0]) defaultBusinessCategoryModuleId = null;
  }

  const id = `drp:${createHash("sha256")
    .update(`${input.organizationId}\u001f${input.attributionSubjectId}`)
    .digest("hex")
    .slice(0, 24)}`;
  const inserted = await db.query<PlacementRow>(
    `
    insert into driver_registration_placements (
      id, organization_id, attribution_subject_id, driver_group_module_id,
      default_business_category_module_id
    ) values ($1, $2, $3, $4, $5)
    on conflict (organization_id, attribution_subject_id) do nothing
    returning id, organization_id, attribution_subject_id, driver_group_module_id,
              default_business_category_module_id
    `,
    [
      id,
      input.organizationId,
      input.attributionSubjectId,
      moduleId,
      defaultBusinessCategoryModuleId,
    ],
  );
  if (inserted.rows[0]) return toPlacement(inserted.rows[0]);
  return getDriverRegistrationPlacement(db, input);
}

export async function listDriverRegistrationPlacements(
  db: Queryable,
  input: { organizationId: string },
): Promise<DriverRegistrationPlacement[]> {
  const result = await db.query<PlacementRow>(
    `
    select id, organization_id, attribution_subject_id, driver_group_module_id,
           default_business_category_module_id
    from driver_registration_placements
    where organization_id = $1
    order by attribution_subject_id
    `,
    [input.organizationId],
  );
  return result.rows.map(toPlacement);
}
