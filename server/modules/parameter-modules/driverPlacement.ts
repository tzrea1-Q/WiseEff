/**
 * D-AG-04 / TD-046: retained registration default placement reads and bootstrap.
 */

import type { Queryable } from "../../shared/database/client";

export async function getDriverRegistrationDefaultBusinessCategoryId(
  db: Queryable,
  input: { attributionSubjectId: string; organizationId?: string },
): Promise<string | null> {
  const placement = input.organizationId
    ? await db.query<{ default_business_category_module_id: string | null }>(
        `
        select drp.default_business_category_module_id
        from driver_registration_placements drp
        inner join attribution_subjects asub
          on asub.id = drp.attribution_subject_id
         and asub.subject_kind = 'driver-registration'
         and (asub.organization_id is null or asub.organization_id = drp.organization_id)
        where drp.organization_id = $1 and drp.attribution_subject_id = $2
        limit 1
        `,
        [input.organizationId, input.attributionSubjectId],
      )
    : await db.query<{ default_business_category_module_id: string | null }>(
        `
        select drp.default_business_category_module_id
        from driver_registration_placements drp
        inner join attribution_subjects asub
          on asub.id = drp.attribution_subject_id
         and asub.subject_kind = 'driver-registration'
         and (asub.organization_id is null or asub.organization_id = drp.organization_id)
        where drp.attribution_subject_id = $1
        order by drp.organization_id
        limit 1
        `,
        [input.attributionSubjectId],
      );
  if (input.organizationId) {
    // An organization placement row is authoritative even when its default
    // is deliberately null. If the row is absent, a legacy registration
    // default may be used only after proving that its category belongs to the
    // same organization; never leak a cross-tenant/global category.
    if (placement.rows[0])
      return placement.rows[0].default_business_category_module_id ?? null;
    const legacy = await db.query<{
      default_business_category_module_id: string | null;
    }>(
      `
      select dr.default_business_category_module_id
      from driver_registrations dr
      inner join attribution_subjects subject
        on subject.id = dr.attribution_subject_id
       and subject.subject_kind = 'driver-registration'
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
  if (placement.rows[0])
    return placement.rows[0].default_business_category_module_id ?? null;
  const result = await db.query<{
    default_business_category_module_id: string | null;
  }>(
    `
    select dr.default_business_category_module_id
    from driver_registrations dr
    inner join attribution_subjects subject
      on subject.id = dr.attribution_subject_id
     and subject.subject_kind = 'driver-registration'
     and subject.organization_id is null
    where dr.attribution_subject_id = $1
    limit 1
    `,
    [input.attributionSubjectId],
  );
  return result.rows[0]?.default_business_category_module_id ?? null;
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
    (input.organizationId
      ? subjectRow.organization_id !== null &&
        subjectRow.organization_id !== input.organizationId
      : subjectRow.organization_id !== null)
  ) {
    throw new Error(
      `Invalid driver registration subject ${input.attributionSubjectId}.`,
    );
  }
  const placement = await db.query<{
    default_business_category_module_id: string | null;
  }>(
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
      ? [
          input.attributionSubjectId,
          input.organizationId,
          input.defaultBusinessCategoryModuleId,
        ]
      : [input.attributionSubjectId, input.defaultBusinessCategoryModuleId],
  );
  if (placement.rows[0]?.default_business_category_module_id) {
    return placement.rows[0].default_business_category_module_id;
  }
  const result = input.organizationId
    ? {
        rows: [] as Array<{
          default_business_category_module_id: string | null;
        }>,
      }
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
