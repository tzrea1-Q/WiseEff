/**
 * D-AG-04 / TD-046: registration default business category placement helpers.
 * Curated driver-groups stay frozen; auto driver-groups reparent without
 * promoting origin to curated.
 */

import type { Queryable } from "../../shared/database/client";
import {
  getParameterModuleById,
  reparentAutoParameterModule,
} from "../parameters/parameterModuleRepository";

export type DriverPlacementReplayCounts = {
  moved: number;
  skippedCurated: number;
  skippedMissingDefault: number;
};

export async function getDriverRegistrationDefaultBusinessCategoryId(
  db: Queryable,
  input: { attributionSubjectId: string; organizationId?: string },
): Promise<string | null> {
  const placement = input.organizationId
    ? await db.query<{ default_business_category_module_id: string | null }>(
        `
        select default_business_category_module_id
        from driver_registration_placements
        where organization_id = $1 and attribution_subject_id = $2
        limit 1
        `,
        [input.organizationId, input.attributionSubjectId],
      )
    : await db.query<{ default_business_category_module_id: string | null }>(
        `
        select default_business_category_module_id
        from driver_registration_placements
        where attribution_subject_id = $1
        order by organization_id
        limit 1
        `,
        [input.attributionSubjectId],
      );
  if (input.organizationId) {
    // An organization placement row is authoritative even when its default
    // is deliberately null. If the row is absent, a legacy registration
    // default may be used only after proving that its category belongs to the
    // same organization; never leak a cross-tenant/global category.
    if (placement.rows[0]) return placement.rows[0].default_business_category_module_id ?? null;
    const legacy = await db.query<{ default_business_category_module_id: string | null }>(
      `
      select dr.default_business_category_module_id
      from driver_registrations dr
      inner join attribution_subjects subject on subject.id = dr.attribution_subject_id
      inner join parameter_modules category
        on category.id = dr.default_business_category_module_id
       and category.organization_id = $2
       and category.kind = 'business'
      where dr.attribution_subject_id = $1
        and subject.organization_id is not distinct from $2
      limit 1
      `,
      [input.attributionSubjectId, input.organizationId],
    );
    return legacy.rows[0]?.default_business_category_module_id ?? null;
  }
  if (placement.rows[0]) return placement.rows[0].default_business_category_module_id ?? null;
  const result = await db.query<{ default_business_category_module_id: string | null }>(
    `
    select default_business_category_module_id
    from driver_registrations
    where attribution_subject_id = $1
    limit 1
    `,
    [input.attributionSubjectId],
  );
  return result.rows[0]?.default_business_category_module_id ?? null;
}

export async function setDriverRegistrationDefaultBusinessCategoryId(
  db: Queryable,
  input: {
    attributionSubjectId: string;
    defaultBusinessCategoryModuleId: string | null;
    organizationId?: string;
  },
): Promise<void> {
  const placement = await db.query(
    input.organizationId
      ? `
        update driver_registration_placements
        set default_business_category_module_id = $3,
            updated_at = now()
        where attribution_subject_id = $1 and organization_id = $2
        returning default_business_category_module_id
        `
      : `
        update driver_registration_placements
        set default_business_category_module_id = $2,
            updated_at = now()
        where attribution_subject_id = $1
        returning default_business_category_module_id
        `,
    input.organizationId
      ? [input.attributionSubjectId, input.organizationId, input.defaultBusinessCategoryModuleId]
      : [input.attributionSubjectId, input.defaultBusinessCategoryModuleId],
  );
  if (input.organizationId && !placement.rows[0]) {
    throw new Error(
      `Missing organization driver placement for ${input.organizationId}/${input.attributionSubjectId}.`,
    );
  }
  if (!input.organizationId) {
    const registration = await db.query(
      `
      update driver_registrations
      set default_business_category_module_id = $2
      where attribution_subject_id = $1
      returning default_business_category_module_id
      `,
      [input.attributionSubjectId, input.defaultBusinessCategoryModuleId],
    );
    if (!registration.rows[0] && registration.rowCount === 0 && !placement.rows[0] && placement.rowCount === 0) {
      throw new Error(`Missing driver registration ${input.attributionSubjectId}.`);
    }
  }
}

/**
 * Bootstrap-once: write default only when currently null.
 * Returns the effective default id after the write (existing or newly set).
 */
export async function bootstrapDriverRegistrationDefaultIfNull(
  db: Queryable,
  input: {
    attributionSubjectId: string;
    defaultBusinessCategoryModuleId: string;
    organizationId?: string;
  },
): Promise<string> {
  const placement = await db.query<{ default_business_category_module_id: string | null }>(
    input.organizationId
      ? `
        update driver_registration_placements
        set default_business_category_module_id = coalesce(
          default_business_category_module_id,
          $3
        ), updated_at = now()
        where attribution_subject_id = $1 and organization_id = $2
        returning default_business_category_module_id
        `
      : `
        update driver_registration_placements
        set default_business_category_module_id = coalesce(
          default_business_category_module_id,
          $2
        ), updated_at = now()
        where attribution_subject_id = $1
        returning default_business_category_module_id
        `,
    input.organizationId
      ? [input.attributionSubjectId, input.organizationId, input.defaultBusinessCategoryModuleId]
      : [input.attributionSubjectId, input.defaultBusinessCategoryModuleId],
  );
  if (placement.rows[0]?.default_business_category_module_id) {
    return placement.rows[0].default_business_category_module_id;
  }
  const result = input.organizationId
    ? { rows: [] as Array<{ default_business_category_module_id: string | null }> }
    : await db.query<{ default_business_category_module_id: string | null }>(
        `
        update driver_registrations
        set default_business_category_module_id = coalesce(
          default_business_category_module_id,
          $2
        )
        where attribution_subject_id = $1
        returning default_business_category_module_id
        `,
        [input.attributionSubjectId, input.defaultBusinessCategoryModuleId],
      );
  return (
    result.rows[0]?.default_business_category_module_id ??
    input.defaultBusinessCategoryModuleId
  );
}

export async function findAttributionSubjectIdBySourceKey(
  db: Queryable,
  input: { organizationId: string; sourceKey: string },
): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `
    select id
    from attribution_subjects
    where organization_id is not distinct from $1
      and source_key = $2
    limit 1
    `,
    [input.organizationId, input.sourceKey],
  );
  return result.rows[0]?.id ?? null;
}

/**
 * Reparent the auto driver-group for a subject under the registration default.
 * Curated modules are never moved. Auto node-type children stay under the
 * driver-group (path rewrite cascades from reparent).
 */
export async function replayAutoDriverGroupToRegistrationDefault(
  db: Queryable,
  input: {
    organizationId: string;
    moduleId: string;
  },
): Promise<DriverPlacementReplayCounts> {
  const counts: DriverPlacementReplayCounts = {
    moved: 0,
    skippedCurated: 0,
    skippedMissingDefault: 0,
  };

  const module = await getParameterModuleById(db, {
    organizationId: input.organizationId,
    moduleId: input.moduleId,
  });
  if (!module || module.kind !== "driver-group" || !module.attributionSubjectId) {
    counts.skippedMissingDefault += 1;
    return counts;
  }

  if (module.origin !== "auto") {
    counts.skippedCurated += 1;
    return counts;
  }

  const defaultId = await getDriverRegistrationDefaultBusinessCategoryId(db, {
    attributionSubjectId: module.attributionSubjectId,
    organizationId: input.organizationId,
  });
  if (!defaultId) {
    counts.skippedMissingDefault += 1;
    return counts;
  }

  const parent = await getParameterModuleById(db, {
    organizationId: input.organizationId,
    moduleId: defaultId,
  });
  if (!parent || parent.kind !== "business") {
    counts.skippedMissingDefault += 1;
    return counts;
  }

  const result = await reparentAutoParameterModule(db, {
    organizationId: input.organizationId,
    moduleId: module.id,
    parentId: defaultId,
  });

  if (result.status === "moved") {
    counts.moved += 1;
  } else if (result.status === "skipped" && result.reason === "curated") {
    counts.skippedCurated += 1;
  } else if (result.status === "skipped" && result.reason === "noop") {
    // already under default — not a failure
  } else if (result.status === "skipped" && result.reason === "missing") {
    counts.skippedMissingDefault += 1;
  }

  return counts;
}
