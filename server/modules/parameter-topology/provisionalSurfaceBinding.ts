import type { Queryable } from "../../shared/database/client";
import { buildManualSpecIds } from "../parameter-specs/specIdentity";
import {
  draftValueShapeToJson,
  inferDraftValueShapeFromOccurrence,
} from "../parameter-specs/valueShapeInference";

/**
 * Org-owned draft spec for unmatched surface properties so bindings appear in the workbench.
 */
export async function upsertProvisionalSurfacePropertySpec(
  db: Queryable,
  input: {
    organizationId: string;
    propertyKey: string;
    driverModule: string | null;
    occurrenceAstJson: unknown;
    occurrenceRawText: string | null;
  },
): Promise<{ parameterSpecId: string; parameterSpecVersionId: string }> {
  const ids = buildManualSpecIds({
    organizationId: input.organizationId,
    propertyKey: input.propertyKey,
    driverModule: input.driverModule,
  });
  const inferredShape = inferDraftValueShapeFromOccurrence({
    propertyKey: input.propertyKey,
    astJson: input.occurrenceAstJson,
    rawText: input.occurrenceRawText,
  });
  const valueShape = draftValueShapeToJson(inferredShape);

  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key)
    values ($1, $2, 'manual', $3)
    on conflict (id) do nothing
    `,
    [ids.parameterSpecId, input.organizationId, ids.specificationKey],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle
    ) values ($1, $2, 1, $3, $4, $5::jsonb, null, null, 'draft')
    on conflict (id) do nothing
    `,
    [
      ids.parameterSpecVersionId,
      ids.parameterSpecId,
      input.propertyKey,
      `Provisional surface spec for ${input.propertyKey}`,
      JSON.stringify(valueShape),
    ],
  );
  await db.query(
    `
    insert into dts_property_specs (
      id, parameter_spec_id, driver_schema_id, property_key, schema_namespace,
      units, constraints, documentation
    ) values ($1, $2, null, $3, $4, null, '{}'::jsonb, $5)
    on conflict (id) do nothing
    `,
    [
      ids.dtsPropertySpecId,
      ids.parameterSpecId,
      input.propertyKey,
      ids.schemaNamespace,
      `Provisional surface binding; activate after schema review.`,
    ],
  );

  return {
    parameterSpecId: ids.parameterSpecId,
    parameterSpecVersionId: ids.parameterSpecVersionId,
  };
}
