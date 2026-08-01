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
  input: { attributionSubjectId: string },
): Promise<string | null> {
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
  },
): Promise<void> {
  await db.query(
    `
    update driver_registrations
    set default_business_category_module_id = $2
    where attribution_subject_id = $1
    `,
    [input.attributionSubjectId, input.defaultBusinessCategoryModuleId],
  );
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
  },
): Promise<string> {
  const result = await db.query<{ default_business_category_module_id: string | null }>(
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
