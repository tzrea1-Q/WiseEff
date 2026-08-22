/**
 * ADR-0017 Batch 1: definitions are located by identity columns, not by re-deriving id.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { upsertProvisionalSurfacePropertySpec } from "../parameter-topology/provisionalSurfaceBinding";
import { findParameterSpecByIdentity } from "./repository";
import { buildSubjectScopedManualSpecIds } from "./specIdentity";
import { createOrgManualParameterSpec } from "./reviewApply";

const ORG_ID = "org-identity-surrogate";
const SUBJECT_ID = "asub:driver-registration:identity-surrogate-subject";
const PROPERTY_KEY = "identity_surrogate_prop";
const SURROGATE_SPEC_ID = "pspec:historical-surrogate-not-from-hash";

const databaseAvailable = await isTestDatabaseAvailable();

async function seedOrg(db: InMemoryTestDatabase) {
  await db.query(`insert into organizations (id, name) values ($1, 'Identity Surrogate Org')`, [ORG_ID]);
  await db.query(
    `
    insert into attribution_subjects (
      id, organization_id, subject_kind, display_name, origin, source_key
    ) values ($1, $2, 'driver-registration', 'Surrogate Subject', 'curated', 'surrogate-subject')
    `,
    [SUBJECT_ID, ORG_ID],
  );
  await db.query(
    `
    insert into driver_registrations (
      attribution_subject_id, driver_nature, instance_cardinality
    ) values ($1, 'physical-device', 'multiple')
    `,
    [SUBJECT_ID],
  );
}

/**
 * Insert a definition whose id is deliberately not the hash of its identity triple.
 * After ADR-0017, find-or-create must still resolve to this row.
 */
async function seedSurrogateDefinition(db: InMemoryTestDatabase) {
  const hashIds = buildSubjectScopedManualSpecIds({
    organizationId: ORG_ID,
    attributionSubjectId: SUBJECT_ID,
    propertyKey: PROPERTY_KEY,
  });
  expect(hashIds.parameterSpecId).not.toBe(SURROGATE_SPEC_ID);

  await db.query(
    `
    insert into parameter_specs (
      id, organization_id, source_kind, specification_key,
      attribution_subject_id, property_key, definition_lifecycle
    ) values ($1, $2, 'manual', $3, $4, $5, 'draft')
    `,
    [SURROGATE_SPEC_ID, ORG_ID, `surrogate/${PROPERTY_KEY}`, SUBJECT_ID, PROPERTY_KEY],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, documentation, value_shape, lifecycle
    ) values ($1, $2, 1, $3, $3, 'surrogate version row', '{"kind":"unknown"}'::jsonb, 'draft')
    `,
    [`${SURROGATE_SPEC_ID}:v1`, SURROGATE_SPEC_ID, PROPERTY_KEY],
  );
  await db.query(
    `
    insert into dts_property_specs (
      id, parameter_spec_id, property_key, schema_namespace, constraints, documentation
    ) values ($1, $2, $3, 'surrogate', '{}'::jsonb, 'surrogate row')
    `,
    [`${SURROGATE_SPEC_ID}:dts`, SURROGATE_SPEC_ID, PROPERTY_KEY],
  );
}

describe.skipIf(!databaseAvailable)("parameter spec identity surrogate lookup (ADR-0017)", () => {
  let db: InMemoryTestDatabase | null = null;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedOrg(db);
  });

  afterEach(async () => {
    await db?.rollback();
    db = null;
  });

  it("findParameterSpecByIdentity resolves a row whose id does not match the hash formula", async () => {
    await seedSurrogateDefinition(db!);
    const found = await findParameterSpecByIdentity(db!, {
      organizationId: ORG_ID,
      attributionSubjectId: SUBJECT_ID,
      propertyKey: PROPERTY_KEY,
    });
    expect(found).toEqual({
      parameterSpecId: SURROGATE_SPEC_ID,
      parameterSpecVersionId: `${SURROGATE_SPEC_ID}:v1`,
    });
  });

  it("creates localized provisional content and keeps one spec row across repeated upserts", async () => {
    const first = await upsertProvisionalSurfacePropertySpec(db!, {
      organizationId: ORG_ID,
      propertyKey: PROPERTY_KEY,
      attributionSubjectId: SUBJECT_ID,
      occurrenceAstJson: { type: "integer", value: 1 },
      occurrenceRawText: "<1>",
    });
    const second = await upsertProvisionalSurfacePropertySpec(db!, {
      organizationId: ORG_ID,
      propertyKey: PROPERTY_KEY,
      attributionSubjectId: SUBJECT_ID,
      occurrenceAstJson: { type: "integer", value: 2 },
      occurrenceRawText: "<2>",
    });
    expect(second.parameterSpecId).toBe(first.parameterSpecId);
    expect(second.parameterSpecVersionId).toBe(first.parameterSpecVersionId);

    const counted = await db!.query<{ n: string | number }>(
      `
      select count(*)::int as n
      from parameter_specs
      where organization_id = $1
        and attribution_subject_id = $2
        and property_key = $3
      `,
      [ORG_ID, SUBJECT_ID, PROPERTY_KEY],
    );
    expect(Number(counted.rows[0]?.n)).toBe(1);

    const content = await db!.query<{
      description: string;
      versionDocumentation: string | null;
      propertyDocumentation: string;
      effectiveDocumentation: string;
    }>(
      `
      select
        v.description,
        v.documentation as "versionDocumentation",
        d.documentation as "propertyDocumentation",
        coalesce(v.documentation, d.documentation) as "effectiveDocumentation"
      from parameter_spec_versions v
      inner join dts_property_specs d on d.parameter_spec_id = v.parameter_spec_id
      where v.parameter_spec_id = $1
      `,
      [first.parameterSpecId],
    );
    expect(content.rows).toEqual([
      {
        description: `参数「${PROPERTY_KEY}」由 DTS 表面发现，等待参数定义审阅。`,
        versionDocumentation: null,
        propertyDocumentation: "临时 DTS 表面绑定；完成参数定义审阅后可激活。",
        effectiveDocumentation: "临时 DTS 表面绑定；完成参数定义审阅后可激活。",
      },
    ]);
  });

  it("does not rewrite persisted legacy content when an existing surface spec is reused", async () => {
    await seedSurrogateDefinition(db!);
    await db!.query(
      `update parameter_spec_versions
       set description = $2,
         documentation = $3,
         version_status = 'active'
       where parameter_spec_id = $1`,
      [
        SURROGATE_SPEC_ID,
        `Provisional surface spec for ${PROPERTY_KEY}`,
        "Provisional surface binding; activate after schema review.",
      ],
    );
    await db!.query(
      `update dts_property_specs
       set documentation = 'Provisional surface binding; activate after schema review.'
       where parameter_spec_id = $1`,
      [SURROGATE_SPEC_ID],
    );

    await upsertProvisionalSurfacePropertySpec(db!, {
      organizationId: ORG_ID,
      propertyKey: PROPERTY_KEY,
      attributionSubjectId: SUBJECT_ID,
      occurrenceAstJson: { type: "integer", value: 9 },
      occurrenceRawText: "<9>",
    });

    const content = await db!.query<{
      description: string;
      versionDocumentation: string;
      propertyDocumentation: string;
      effectiveDocumentation: string;
    }>(
      `
      select
        v.description,
        v.documentation as "versionDocumentation",
        d.documentation as "propertyDocumentation",
        coalesce(v.documentation, d.documentation) as "effectiveDocumentation"
      from parameter_spec_versions v
      inner join dts_property_specs d on d.parameter_spec_id = v.parameter_spec_id
      where v.parameter_spec_id = $1
      `,
      [SURROGATE_SPEC_ID],
    );
    expect(content.rows).toEqual([
      {
        description: `Provisional surface spec for ${PROPERTY_KEY}`,
        versionDocumentation: "Provisional surface binding; activate after schema review.",
        propertyDocumentation: "Provisional surface binding; activate after schema review.",
        effectiveDocumentation: "Provisional surface binding; activate after schema review.",
      },
    ]);
  });

  it("provisional upsert reuses a corrected surrogate row without overwriting human-authored content", async () => {
    await seedSurrogateDefinition(db!);
    const reused = await upsertProvisionalSurfacePropertySpec(db!, {
      organizationId: ORG_ID,
      propertyKey: PROPERTY_KEY,
      attributionSubjectId: SUBJECT_ID,
      occurrenceAstJson: { type: "integer", value: 9 },
      occurrenceRawText: "<9>",
    });
    expect(reused.parameterSpecId).toBe(SURROGATE_SPEC_ID);

    const hashIds = buildSubjectScopedManualSpecIds({
      organizationId: ORG_ID,
      attributionSubjectId: SUBJECT_ID,
      propertyKey: PROPERTY_KEY,
    });
    const hashRow = await db!.query<{ n: string | number }>(
      `select count(*)::int as n from parameter_specs where id = $1`,
      [hashIds.parameterSpecId],
    );
    expect(Number(hashRow.rows[0]?.n)).toBe(0);

    const counted = await db!.query<{ n: string | number }>(
      `
      select count(*)::int as n
      from parameter_specs
      where organization_id = $1
        and attribution_subject_id = $2
        and property_key = $3
      `,
      [ORG_ID, SUBJECT_ID, PROPERTY_KEY],
    );
    expect(Number(counted.rows[0]?.n)).toBe(1);

    const content = await db!.query<{
      description: string;
      versionDocumentation: string;
      propertyDocumentation: string;
      effectiveDocumentation: string;
    }>(
      `
      select
        v.description,
        v.documentation as "versionDocumentation",
        d.documentation as "propertyDocumentation",
        coalesce(v.documentation, d.documentation) as "effectiveDocumentation"
      from parameter_spec_versions v
      inner join dts_property_specs d on d.parameter_spec_id = v.parameter_spec_id
      where v.parameter_spec_id = $1
      `,
      [SURROGATE_SPEC_ID],
    );
    expect(content.rows).toEqual([
      {
        description: PROPERTY_KEY,
        versionDocumentation: "surrogate version row",
        propertyDocumentation: "surrogate row",
        effectiveDocumentation: "surrogate version row",
      },
    ]);
  });

  it("createOrgManualParameterSpec reuses a surrogate identity row", async () => {
    await seedSurrogateDefinition(db!);
    const result = await createOrgManualParameterSpec(db!, {
      organizationId: ORG_ID,
      propertyKey: PROPERTY_KEY,
      attributionSubjectId: SUBJECT_ID,
      sourceReviewTaskId: "task-identity-1",
      propertyOccurrenceId: "occ-identity-1",
      configRevisionId: "rev-identity-1",
      reviewerUserId: "user-identity-1",
      occurrenceAstJson: { type: "integer", value: 3 },
      occurrenceRawText: "<3>",
    });
    expect(result.created).toBe(false);
    expect(result.parameterSpecId).toBe(SURROGATE_SPEC_ID);
  });
});
