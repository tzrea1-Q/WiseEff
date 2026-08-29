import { createHash } from "node:crypto";

import type { Queryable } from "../../shared/database/client";

export type DriverRegistrationPlacement = {
  id: string;
  organizationId: string;
  attributionSubjectId: string;
  driverGroupModuleId: string;
  defaultBusinessCategoryModuleId: string | null;
};

export type NodeTypeDefinitionPlacement = {
  moduleId: string;
  moduleName: string;
  categoryId: string | null;
  categoryName: string | null;
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
  options: { forUpdate?: boolean } = {},
): Promise<DriverRegistrationPlacement | null> {
  const result = await db.query<PlacementRow>(
    `
    select drp.id, drp.organization_id, drp.attribution_subject_id,
           drp.driver_group_module_id, drp.default_business_category_module_id
    from driver_registration_placements drp
    inner join attribution_subjects asub
      on asub.id = drp.attribution_subject_id
     and asub.subject_kind = 'driver-registration'
     and (asub.organization_id is null or asub.organization_id = drp.organization_id)
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
    ${options.forUpdate ? "for update of drp" : ""}
    `,
    [input.organizationId, input.attributionSubjectId],
  );
  return result.rows[0] ? toPlacement(result.rows[0]) : null;
}

/**
 * Resolve the organization taxonomy module for a NodeTypeDefinition. Platform
 * schemas are shared, so the subject id may differ from the organization
 * module's subject id; the stable nodetype source key is the cross-scope link.
 */
export async function getNodeTypeDefinitionPlacement(
  db: Queryable,
  input: {
    organizationId: string;
    attributionSubjectId: string;
    sourceKey: string;
  },
): Promise<NodeTypeDefinitionPlacement | null> {
  const result = await db.query<{
    module_id: string;
    module_name: string;
    category_id: string | null;
    category_name: string | null;
  }>(
    `
    select node_type.id as module_id,
           node_type.name as module_name,
           case when parent.kind = 'business' then parent.id else null end as category_id,
           case when parent.kind = 'business' then parent.name else null end as category_name
    from parameter_modules node_type
    inner join attribution_subjects asub
      on asub.id = $2
     and asub.subject_kind = 'node-type-definition'
     and (asub.organization_id is null or asub.organization_id = $1)
    left join parameter_modules parent
      on parent.id = node_type.parent_id
     and parent.organization_id = node_type.organization_id
    where node_type.organization_id = $1
      and node_type.kind = 'node-type'
      and exists (
        select 1
        from node_type_definitions ntd
        where ntd.attribution_subject_id = $2
      )
      and (
        node_type.attribution_subject_id = $2
        or lower(coalesce(node_type.source_key, '')) = lower($3)
      )
    order by case when node_type.attribution_subject_id = $2 then 0 else 1 end,
             node_type.id
    `,
    [input.organizationId, input.attributionSubjectId, input.sourceKey],
  );
  // A node type may be discoverable both by its canonical subject and by its
  // stable source key. If more than one taxonomy row matches, choosing the
  // first row would turn placement ambiguity into a false effective result.
  // Leave it for governance/reconciliation instead.
  if (result.rows.length !== 1) return null;
  const row = result.rows[0];
  return row
    ? {
        moduleId: row.module_id,
        moduleName: row.module_name,
        categoryId: row.category_id,
        categoryName: row.category_name,
      }
    : null;
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
  const subject = await db.query<{
    subject_kind: string;
    organization_id: string | null;
  }>(
    `select subject_kind, organization_id from attribution_subjects where id = $1 limit 1`,
    [input.attributionSubjectId],
  );
  const subjectRow = subject.rows[0];
  if (
    !subjectRow ||
    subjectRow.subject_kind !== "driver-registration" ||
    (subjectRow.organization_id !== null &&
      subjectRow.organization_id !== input.organizationId)
  ) {
    return null;
  }
  const existing = await getDriverRegistrationPlacement(db, input, {
    forUpdate: true,
  });
  if (existing) return existing;
  // Keep the unique legacy row instead of attempting an insert that silently
  // loses on conflict. A row can be stale because its module/category was
  // deleted, reclassified, or moved to another tenant; reconcile that one row
  // in place once a safe replacement is available.
  const existingRaw = await db.query<{
    id: string;
    driver_group_module_id: string;
    default_business_category_module_id: string | null;
  }>(
    `select id, driver_group_module_id, default_business_category_module_id
     from driver_registration_placements
     where organization_id = $1 and attribution_subject_id = $2
     for update`,
    [input.organizationId, input.attributionSubjectId],
  );
  const existingRawRow = existingRaw.rows[0];

  const requestedModuleId =
    input.driverGroupModuleId ?? existingRawRow?.driver_group_module_id ?? null;
  let moduleResult = requestedModuleId
    ? await db.query<{ id: string }>(
        `
        select id from parameter_modules
        where id = $1 and organization_id = $2 and kind = 'driver-group'
          and attribution_subject_id = $3
        limit 1
        `,
        [requestedModuleId, input.organizationId, input.attributionSubjectId],
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
  if (
    !input.driverGroupModuleId &&
    existingRawRow &&
    moduleResult.rows.length === 0
  ) {
    moduleResult = await db.query<{ id: string }>(
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
  }
  if (!input.driverGroupModuleId && moduleResult.rows.length !== 1) {
    // Multiple modules for one registration are exactly the ambiguity this
    // placement row is meant to remove. Do not pick by id and make the
    // effective catalog appear healthy; leave it for reconciliation/governance.
    return null;
  }
  const moduleId = moduleResult.rows[0]?.id;
  if (!moduleId) return null;

  let defaultBusinessCategoryModuleId =
    input.defaultBusinessCategoryModuleId ??
    existingRawRow?.default_business_category_module_id ??
    null;
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
  if (existingRawRow) {
    await db.query(
      `update driver_registration_placements
       set driver_group_module_id = $2,
           default_business_category_module_id = $3,
           updated_at = now()
       where id = $1`,
      [existingRawRow.id, moduleId, defaultBusinessCategoryModuleId],
    );
    return getDriverRegistrationPlacement(db, input);
  }
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
    select drp.id, drp.organization_id, drp.attribution_subject_id, drp.driver_group_module_id,
           drp.default_business_category_module_id
    from driver_registration_placements drp
    inner join attribution_subjects asub
      on asub.id = drp.attribution_subject_id
     and asub.subject_kind = 'driver-registration'
     and (asub.organization_id is null or asub.organization_id = drp.organization_id)
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
      and (
        drp.default_business_category_module_id is null
        or (category.organization_id = drp.organization_id and category.kind = 'business')
      )
    order by drp.attribution_subject_id
    `,
    [input.organizationId],
  );
  return result.rows.map(toPlacement);
}
