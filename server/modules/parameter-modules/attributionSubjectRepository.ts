import type { Queryable } from "../../shared/database/client";
import {
  attributionSubjectIdForModule,
  defaultDriverRegistrationAttributes,
  type AttributionSubjectKind,
} from "./attributionSubjects";

export async function insertAttributionSubjectForNewModule(
  db: Queryable,
  input: {
    moduleId: string;
    organizationId: string | null;
    kind: "driver-group" | "node-type";
    displayName: string;
    origin: "curated" | "auto";
    sourceKey: string | null;
    notes?: string;
    /** Authoritative auto-placement parent (D-AG-04). */
    defaultBusinessCategoryModuleId?: string | null;
  },
): Promise<string> {
  const subjectKind: AttributionSubjectKind =
    input.kind === "driver-group" ? "driver-registration" : "node-type-definition";
  const preferredId = attributionSubjectIdForModule(input.moduleId, subjectKind);
  const sourceKey =
    input.sourceKey?.trim() ||
    (input.kind === "driver-group"
      ? `compatible:legacy:${input.moduleId}`
      : `nodetype:legacy:${input.moduleId}`);

  // Prefer an existing catalog subject for this owner scope + source_key so
  // seeds and shared-DB fixtures stay idempotent when module row ids drift.
  const existingBySource = await db.query<{ id: string }>(
    `
    select id
    from attribution_subjects
    where organization_id is not distinct from $1
      and source_key = $2
    limit 1
    `,
    [input.organizationId, sourceKey],
  );
  const subjectId = existingBySource.rows[0]?.id ?? preferredId;

  await db.query(
    `
    insert into attribution_subjects (
      id, organization_id, subject_kind, display_name, origin, source_key
    ) values ($1, $2, $3, $4, $5, $6)
    on conflict (id) do nothing
    `,
    [subjectId, input.organizationId, subjectKind, input.displayName, input.origin, sourceKey],
  );

  if (input.kind === "driver-group") {
    const defaults = defaultDriverRegistrationAttributes();
    await db.query(
      `
      insert into driver_registrations (
        attribution_subject_id,
        driver_nature,
        instance_cardinality,
        notes,
        default_business_category_module_id
      ) values ($1, $2, $3, $4, $5)
      on conflict (attribution_subject_id) do nothing
      `,
      [
        subjectId,
        defaults.driverNature,
        defaults.instanceCardinality,
        input.notes ?? "",
        input.defaultBusinessCategoryModuleId ?? null,
      ],
    );
    if (input.defaultBusinessCategoryModuleId) {
      await db.query(
        `
        update driver_registrations
        set default_business_category_module_id = coalesce(
          default_business_category_module_id,
          $2
        )
        where attribution_subject_id = $1
        `,
        [subjectId, input.defaultBusinessCategoryModuleId],
      );
    }
  } else {
    const bareNodeName = sourceKey.startsWith("nodetype:")
      ? sourceKey.slice("nodetype:".length)
      : input.displayName;
    await db.query(
      `
      insert into node_type_definitions (
        attribution_subject_id, bare_node_name
      ) values ($1, $2)
      on conflict (attribution_subject_id) do nothing
      `,
      [subjectId, bareNodeName || input.displayName],
    );
  }

  return subjectId;
}
