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
    organizationId: string;
    kind: "driver-group" | "node-type";
    displayName: string;
    origin: "curated" | "auto";
    sourceKey: string | null;
    notes?: string;
  },
): Promise<string> {
  const subjectKind: AttributionSubjectKind =
    input.kind === "driver-group" ? "driver-registration" : "node-type-definition";
  const subjectId = attributionSubjectIdForModule(input.moduleId, subjectKind);
  const sourceKey =
    input.sourceKey?.trim() ||
    (input.kind === "driver-group"
      ? `compatible:legacy:${input.moduleId}`
      : `nodetype:legacy:${input.moduleId}`);

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
        attribution_subject_id, driver_nature, instance_cardinality, notes
      ) values ($1, $2, $3, $4)
      on conflict (attribution_subject_id) do nothing
      `,
      [
        subjectId,
        defaults.driverNature,
        defaults.instanceCardinality,
        input.notes ?? "",
      ],
    );
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
