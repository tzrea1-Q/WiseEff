/**
 * TD-117 / ADR-0034 first slice: referenced property-key rename stays refused,
 * and a read-only source-cutover preview lists rewrite locations without
 * writing the catalog triple.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import { createAgentInvocation, createSystemInvocation, createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createPostgresDatabase, type Queryable } from "../../shared/database/client";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { withTempDatabase } from "../../testing/tempDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createTestParameterSubmissionContext } from "../parameters/testSubmissionContext";
import { ApiError } from "../../shared/http/errors";
import { assertTrustedSensitiveNodeWriteAllowed } from "../parameter-kernel/sensitiveNode";
import { activateCandidate } from "../parameter-files/candidateService";
import { getParameterFileCandidateById } from "../parameter-files/candidateRepository";
import { getProjectParameterFileById } from "../parameter-files/repository";
import {
  finalizePropertyKeySourceCutover,
  getOpenPropertyKeySourceCutover,
  preparePropertyKeySourceCutover,
  previewPropertyKeySourceCutover,
  startPropertyKeySourceCutover,
} from "./propertyKeyCutover";
import { renameParameterSpecPropertyKey } from "./service";

const ORG_ID = "org-pk-cutover";
const USER_ID = "user-pk-cutover";
const SUBJECT_A = "asub:driver-registration:pk-cutover-a";
const SUBJECT_B = "asub:driver-registration:pk-cutover-b";
const SPEC_ID = "pspec:pk-cutover-main";
const BLOCKER_ID = "pspec:pk-cutover-blocker";
const FROM_KEY = "typo_prop";
const TO_KEY = "corrected_prop";
const PROJECT_ID = "project-pk-cutover";
const MODULE_ID = "mod-pk-cutover";
const BINDING_WITH_OCCURRENCE = "binding-pk-cutover-occ";
const BINDING_WITHOUT_REVISION = "binding-pk-cutover-bare";
const CONFIG_SET_ID = "cs-pk-cutover";
const CONFIG_REVISION_ID = "cr-pk-cutover";
const LOGICAL_NODE_ID = "ln-pk-cutover";
const FILE_ID = "file-pk-cutover";
const FILE_VERSION_ID = "fv-pk-cutover";
const PROPERTY_OCCURRENCE_ID = "po-pk-cutover";
const BOARD_DTS = `/dts-v1/;
/ {
	charger@6e {
		typo_prop = <1>;
	};
};
`;

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(): AuthContext {
  return makeTestAuthContext({
    userId: USER_ID,
    organizationId: ORG_ID,
    name: "PK Cutover Admin",
    email: "pk-cutover@example.com",
    organizationName: "PK Cutover Org",
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  });
}

async function seedSubject(db: Queryable, id: string, sourceKey: string) {
  await db.query(
    `
    insert into attribution_subjects (
      id, organization_id, subject_kind, display_name, origin, source_key
    ) values ($1, $2, 'driver-registration', $3, 'curated', $4)
    `,
    [id, ORG_ID, sourceKey, sourceKey],
  );
  await db.query(
    `
    insert into driver_registrations (
      attribution_subject_id, driver_nature, instance_cardinality
    ) values ($1, 'physical-device', 'multiple')
    `,
    [id],
  );
}

async function seedSpec(
  db: Queryable,
  input: {
    specId: string;
    subjectId: string;
    propertyKey: string;
    specificationKey?: string;
    lifecycle?: "draft" | "active" | "deprecated";
  },
) {
  await db.query(
    `
    insert into parameter_specs (
      id, organization_id, source_kind, specification_key,
      attribution_subject_id, property_key, definition_lifecycle
    ) values ($1, $2, 'manual', $3, $4, $5, $6)
    `,
    [
      input.specId,
      ORG_ID,
      input.specificationKey ?? `manual/${input.propertyKey}`,
      input.subjectId,
      input.propertyKey,
      input.lifecycle ?? "active",
    ],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      lifecycle, version_status
    ) values ($1, $2, 1, $3, $3, '{"kind":"unknown"}'::jsonb, $4, $5)
    `,
    [
      `${input.specId}:v1`,
      input.specId,
      input.propertyKey,
      input.lifecycle === "deprecated" ? "active" : (input.lifecycle ?? "active"),
      input.lifecycle === "draft" ? "draft" : "active",
    ],
  );
  await db.query(
    `
    insert into dts_property_specs (
      id, parameter_spec_id, property_key, schema_namespace, constraints, documentation
    ) values ($1, $2, $3, 'manual', '{}'::jsonb, 'doc')
    `,
    [`${input.specId}:dts`, input.specId, input.propertyKey],
  );
}

async function seedReferencedBindings(
  db: Queryable,
  objectStore?: ReturnType<typeof createMemoryObjectStore>,
) {
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'PK Cutover', 'PKC', 'initialized')`,
    [PROJECT_ID, ORG_ID],
  );
  await db.query(
    `
    insert into parameter_modules (
      id, organization_id, name, path, depth, kind, origin, parent_id, sort_order
    ) values ($1, $2, 'Unclassified', 'Unclassified', 0, 'unclassified', 'auto', null, 0)
    `,
    [MODULE_ID, ORG_ID],
  );
  await db.query(
    `insert into dts_config_set (id, organization_id, project_id, name)
     values ($1, $2, $3, 'default')`,
    [CONFIG_SET_ID, ORG_ID, PROJECT_ID],
  );
  await db.query(
    `insert into dts_config_revisions (id, organization_id, project_id, config_set_id, revision_number, status)
     values ($1, $2, $3, $4, 1, 'resolved')`,
    [CONFIG_REVISION_ID, ORG_ID, PROJECT_ID, CONFIG_SET_ID],
  );
  await db.query(
    `
    insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled, config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, 'board.dts', 'dts', true, $4, 'base', 0)
    `,
    [FILE_ID, ORG_ID, PROJECT_ID, CONFIG_SET_ID],
  );
  let storageKey = "pk-cutover/board.dts";
  let checksum = "abc";
  let sizeBytes = 12;
  if (objectStore) {
    const stored = await objectStore.put({
      organizationId: ORG_ID,
      fileName: "board.dts",
      contentType: "text/plain",
      bytes: Buffer.from(BOARD_DTS, "utf8"),
    });
    storageKey = stored.storageKey;
    checksum = stored.checksumSha256;
    sizeBytes = stored.fileSizeBytes;
  }
  await db.query(
    `
    insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin
    ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload')
    `,
    [FILE_VERSION_ID, FILE_ID, storageKey, checksum, sizeBytes],
  );
  await db.query(
    `insert into dts_nodes (id, file_version_id, name, node_path, compatible)
     values ($1, $2, 'charger', '/charger@6e', 'wiseeff,cutover')`,
    [`dts-node-pk-cutover-${FILE_VERSION_ID}`, FILE_VERSION_ID],
  );
  await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
    FILE_VERSION_ID,
    FILE_ID,
  ]);
  await db.query(
    `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
     values ($1, $2, $3, $4)`,
    [LOGICAL_NODE_ID, ORG_ID, PROJECT_ID, CONFIG_SET_ID],
  );
  const logicalNodeRevisionId = "lnr-pk-cutover";
  await db.query(
    `
    insert into dts_logical_node_revisions (
      id, logical_node_id, config_revision_id, node_locator, name
    ) values ($1, $2, $3, '/charger@6e', 'charger')
    `,
    [logicalNodeRevisionId, LOGICAL_NODE_ID, CONFIG_REVISION_ID],
  );
  const nodeOccurrenceId = "no-pk-cutover";
  await db.query(
    `
    insert into dts_node_occurrences (
      id, config_revision_id, file_version_id, name, labels, node_path,
      start_offset, end_offset, start_line, start_column, end_line, end_column,
      raw_text, ast_json, source_order
    ) values ($1, $2, $3, 'charger', '[]'::jsonb, '/charger@6e', 0, 80, 1, 1, 4, 2, 'node', '{}'::jsonb, 0)
    `,
    [nodeOccurrenceId, CONFIG_REVISION_ID, FILE_VERSION_ID],
  );
  await db.query(
    `
    insert into dts_property_occurrences (
      id, config_revision_id, node_occurrence_id, file_version_id, property_name,
      start_offset, end_offset, start_line, start_column, end_line, end_column,
      raw_text, ast_json, source_order
    ) values ($1, $2, $3, $4, $5, 10, 28, 2, 3, 2, 20, '<1>', '{}'::jsonb, 0)
    `,
    [PROPERTY_OCCURRENCE_ID, CONFIG_REVISION_ID, nodeOccurrenceId, FILE_VERSION_ID, FROM_KEY],
  );
  await db.query(
    `
    insert into dts_occurrence_effects (
      id, config_revision_id, logical_node_revision_id, property_occurrence_id, node_occurrence_id,
      property_name, effect_kind, source_order
    ) values ($1, $2, $3, $4, $5, $6, 'set', 1)
    `,
    [
      "oe-pk-cutover",
      CONFIG_REVISION_ID,
      logicalNodeRevisionId,
      PROPERTY_OCCURRENCE_ID,
      nodeOccurrenceId,
      FROM_KEY,
    ],
  );
  await db.query(
    `
    insert into project_parameter_bindings (
      id, organization_id, project_id, parameter_spec_id, module_id, logical_node_id
    ) values ($1, $2, $3, $4, $5, $6)
    `,
    [BINDING_WITH_OCCURRENCE, ORG_ID, PROJECT_ID, SPEC_ID, MODULE_ID, LOGICAL_NODE_ID],
  );
  await db.query(
    `
    insert into project_parameter_binding_revisions (
      id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value
    ) values ('rev-pk-cutover', $1, $2, $3, '{}'::jsonb, '<1>')
    `,
    [BINDING_WITH_OCCURRENCE, CONFIG_REVISION_ID, `${SPEC_ID}:v1`],
  );
  await db.query(
    `
    insert into project_parameter_bindings (
      id, organization_id, project_id, parameter_spec_id, module_id, logical_node_id
    ) values ($1, $2, $3, $4, $5, null)
    `,
    [BINDING_WITHOUT_REVISION, ORG_ID, PROJECT_ID, SPEC_ID, MODULE_ID],
  );
}

async function catalogKeys(db: InMemoryTestDatabase) {
  const spec = await db.query<{ property_key: string; specification_key: string }>(
    `select property_key, specification_key from parameter_specs where id = $1`,
    [SPEC_ID],
  );
  const dts = await db.query<{ property_key: string; schema_namespace: string }>(
    `select property_key, schema_namespace from dts_property_specs where parameter_spec_id = $1`,
    [SPEC_ID],
  );
  return {
    specPropertyKey: spec.rows[0]?.property_key,
    specificationKey: spec.rows[0]?.specification_key,
    dtsPropertyKey: dts.rows[0]?.property_key,
    schemaNamespace: dts.rows[0]?.schema_namespace,
  };
}

describe.skipIf(!databaseAvailable)("property-key source cutover preview (ADR-0034 / TD-117)", () => {
  let db: InMemoryTestDatabase | null = null;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await db.query(`insert into organizations (id, name) values ($1, 'PK Cutover Org')`, [ORG_ID]);
    await db.query(
      `insert into users (id, organization_id, name, email, title, is_active)
       values ($1, $2, 'PK Cutover Admin', 'pk-cutover@example.com', 'Admin', true)`,
      [USER_ID, ORG_ID],
    );
    await seedSubject(db, SUBJECT_A, "subject-a");
    await seedSubject(db, SUBJECT_B, "subject-b");
    await seedSpec(db, { specId: SPEC_ID, subjectId: SUBJECT_A, propertyKey: FROM_KEY });
  });

  afterEach(async () => {
    if (db) {
      await db.rollback();
      db = null;
    }
  });

  it("refuses inline rename-property-key while bindings reference the definition", async () => {
    await seedReferencedBindings(db!);

    await expect(
      renameParameterSpecPropertyKey(db!, makeAuth(), {
        specId: SPEC_ID,
        propertyKey: TO_KEY,
        reason: "has refs",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({
        parameterSpecId: SPEC_ID,
        referenceCount: 2,
      }),
    } satisfies Partial<ApiError>);

    expect(await catalogKeys(db!)).toMatchObject({
      specPropertyKey: FROM_KEY,
      dtsPropertyKey: FROM_KEY,
    });
  });

  it("lists source rewrite locations and does not write the catalog triple", async () => {
    await seedReferencedBindings(db!);
    const before = await catalogKeys(db!);

    const result = await previewPropertyKeySourceCutover(db!, makeAuth(), {
      specId: SPEC_ID,
      propertyKey: TO_KEY,
    });

    expect(result.item).toMatchObject({
      parameterSpecId: SPEC_ID,
      fromKey: FROM_KEY,
      toKey: TO_KEY,
      referenceCount: 2,
      writesCatalog: false,
      writesSource: false,
      inlineRenameEligible: false,
    });
    expect(result.item.locations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: PROJECT_ID,
          bindingId: BINDING_WITH_OCCURRENCE,
          configRevisionId: CONFIG_REVISION_ID,
          propertyOccurrenceId: PROPERTY_OCCURRENCE_ID,
          fileName: "board.dts",
          nodePath: "/charger@6e",
          fromKey: FROM_KEY,
          toKey: TO_KEY,
          status: "would-rewrite",
        }),
        expect.objectContaining({
          projectId: PROJECT_ID,
          bindingId: BINDING_WITHOUT_REVISION,
          fromKey: FROM_KEY,
          toKey: TO_KEY,
          status: "no-occurrence",
        }),
      ]),
    );
    expect(result.item.locations).toHaveLength(2);
    expect(await catalogKeys(db!)).toEqual(before);
  });

  it("reports a triple-collision start blocker without rewriting catalog", async () => {
    await seedReferencedBindings(db!);
    await seedSpec(db!, {
      specId: BLOCKER_ID,
      subjectId: SUBJECT_A,
      propertyKey: TO_KEY,
      specificationKey: `manual/${TO_KEY}-blocker`,
      lifecycle: "deprecated",
    });
    const before = await catalogKeys(db!);

    const result = await previewPropertyKeySourceCutover(db!, makeAuth(), {
      specId: SPEC_ID,
      propertyKey: TO_KEY,
    });

    expect(result.item.writesCatalog).toBe(false);
    expect(result.item.startBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "triple-collision",
          details: expect.objectContaining({
            parameterSpecId: BLOCKER_ID,
            lifecycle: "deprecated",
          }),
        }),
      ]),
    );
    expect(await catalogKeys(db!)).toEqual(before);
  });

  it("reports an open version-cutover start blocker", async () => {
    await seedReferencedBindings(db!);
    await db!.query(
      `
      insert into parameter_spec_version_cutover_runs (
        id, organization_id, parameter_spec_id, from_version_id, to_version_id,
        status, created_by_user_id
      ) values (
        'run-pk-cutover-version', $1, $2, $3, $3, 'preparing', $4
      )
      `,
      [ORG_ID, SPEC_ID, `${SPEC_ID}:v1`, USER_ID],
    );

    const result = await previewPropertyKeySourceCutover(db!, makeAuth(), {
      specId: SPEC_ID,
      propertyKey: TO_KEY,
    });

    expect(result.item.startBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "open-version-cutover",
          details: expect.objectContaining({ runId: "run-pk-cutover-version" }),
        }),
      ]),
    );
    expect(result.item.writesCatalog).toBe(false);
  });
});

async function rewriteOccurrenceToNewKey(db: InMemoryTestDatabase) {
  await db.query(`update dts_property_occurrences set property_name = $1 where id = $2`, [
    TO_KEY,
    PROPERTY_OCCURRENCE_ID,
  ]);
  await db.query(`update dts_occurrence_effects set property_name = $1 where property_occurrence_id = $2`, [
    TO_KEY,
    PROPERTY_OCCURRENCE_ID,
  ]);
}

async function seedRewritableBindingOnly(
  db: Queryable,
  objectStore?: ReturnType<typeof createMemoryObjectStore>,
) {
  await seedReferencedBindings(db, objectStore);
  await db.query(`delete from project_parameter_bindings where id = $1`, [BINDING_WITHOUT_REVISION]);
}

describe.skipIf(!databaseAvailable)("property-key source cutover start/finalize (ADR-0034 / TD-117)", () => {
  let db: InMemoryTestDatabase | null = null;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await db.query(`insert into organizations (id, name) values ($1, 'PK Cutover Org')`, [ORG_ID]);
    await db.query(
      `insert into users (id, organization_id, name, email, title, is_active)
       values ($1, $2, 'PK Cutover Admin', 'pk-cutover@example.com', 'Admin', true)`,
      [USER_ID, ORG_ID],
    );
    await seedSubject(db, SUBJECT_A, "subject-a");
    await seedSubject(db, SUBJECT_B, "subject-b");
    await seedSpec(db, { specId: SPEC_ID, subjectId: SUBJECT_A, propertyKey: FROM_KEY });
  });

  afterEach(async () => {
    if (db) {
      await db.rollback();
      db = null;
    }
  });

  it("preview → start → source rewritten → finalize rewrites the catalog triple", async () => {
    await seedRewritableBindingOnly(db!);
    const preview = await previewPropertyKeySourceCutover(db!, makeAuth(), {
      specId: SPEC_ID,
      propertyKey: TO_KEY,
    });
    expect(preview.item.locations).toEqual([
      expect.objectContaining({
        bindingId: BINDING_WITH_OCCURRENCE,
        status: "would-rewrite",
        fromKey: FROM_KEY,
        toKey: TO_KEY,
      }),
    ]);
    expect(preview.item.startBlockers).toEqual([]);

    const started = await startPropertyKeySourceCutover(db!, makeAuth(), {
      specId: SPEC_ID,
      propertyKey: TO_KEY,
      reason: "correct typo after bindings exist",
    });
    expect(started.item).toMatchObject({
      parameterSpecId: SPEC_ID,
      fromKey: FROM_KEY,
      toKey: TO_KEY,
      status: "preparing",
      writesCatalog: false,
      writesSource: false,
    });
    expect(started.item.items).toEqual([
      expect.objectContaining({
        bindingId: BINDING_WITH_OCCURRENCE,
        status: "pending",
        locationStatus: "would-rewrite",
      }),
    ]);
    expect(await catalogKeys(db!)).toMatchObject({
      specPropertyKey: FROM_KEY,
      dtsPropertyKey: FROM_KEY,
    });

    await expect(
      renameParameterSpecPropertyKey(db!, makeAuth(), {
        specId: SPEC_ID,
        propertyKey: TO_KEY,
        reason: "still referenced",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({ referenceCount: 1 }),
    } satisfies Partial<ApiError>);

    await rewriteOccurrenceToNewKey(db!);

    const finalized = await finalizePropertyKeySourceCutover(db!, makeAuth(), {
      specId: SPEC_ID,
      reason: "sources already use the corrected key",
    });
    expect(finalized.item).toMatchObject({
      parameterSpecId: SPEC_ID,
      fromKey: FROM_KEY,
      toKey: TO_KEY,
      status: "finalized",
      writesCatalog: true,
      writesSource: false,
    });
    expect(finalized.item.items).toEqual([
      expect.objectContaining({
        bindingId: BINDING_WITH_OCCURRENCE,
        status: "skipped",
        locationStatus: "already-new-key",
      }),
    ]);

    const after = await catalogKeys(db!);
    expect(after.specPropertyKey).toBe(TO_KEY);
    expect(after.dtsPropertyKey).toBe(TO_KEY);
    expect(after.specificationKey).not.toBe(`manual/${FROM_KEY}`);
    expect(after.schemaNamespace).not.toBe("manual");
  });

  it("finalize fails closed while the old key is still in source", async () => {
    await seedRewritableBindingOnly(db!);
    await startPropertyKeySourceCutover(db!, makeAuth(), {
      specId: SPEC_ID,
      propertyKey: TO_KEY,
      reason: "start before rewrite",
    });

    await expect(
      finalizePropertyKeySourceCutover(db!, makeAuth(), {
        specId: SPEC_ID,
        reason: "too early",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({
        parameterSpecId: SPEC_ID,
        blockingItems: 1,
      }),
    } satisfies Partial<ApiError>);

    expect(await catalogKeys(db!)).toMatchObject({
      specPropertyKey: FROM_KEY,
      dtsPropertyKey: FROM_KEY,
    });
  });

  it("start and finalize refuse a triple-collision without rewriting catalog", async () => {
    await seedRewritableBindingOnly(db!);
    await seedSpec(db!, {
      specId: BLOCKER_ID,
      subjectId: SUBJECT_A,
      propertyKey: TO_KEY,
      specificationKey: `manual/${TO_KEY}-blocker`,
      lifecycle: "deprecated",
    });

    await expect(
      startPropertyKeySourceCutover(db!, makeAuth(), {
        specId: SPEC_ID,
        propertyKey: TO_KEY,
        reason: "blocked by deprecated twin",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({
        startBlockers: expect.arrayContaining([
          expect.objectContaining({
            code: "triple-collision",
            details: expect.objectContaining({
              parameterSpecId: BLOCKER_ID,
              lifecycle: "deprecated",
            }),
          }),
        ]),
      }),
    } satisfies Partial<ApiError>);

    expect(await catalogKeys(db!)).toMatchObject({
      specPropertyKey: FROM_KEY,
      dtsPropertyKey: FROM_KEY,
    });

    await db!.query(
      `
      insert into parameter_spec_property_key_cutover_runs (
        id, organization_id, parameter_spec_id, from_key, to_key,
        status, created_by_user_id
      ) values (
        'run-pk-cutover-collision', $1, $2, $3, $4, 'ready', $5
      )
      `,
      [ORG_ID, SPEC_ID, FROM_KEY, TO_KEY, USER_ID],
    );
    await rewriteOccurrenceToNewKey(db!);

    await expect(
      finalizePropertyKeySourceCutover(db!, makeAuth(), {
        specId: SPEC_ID,
        reason: "collision still present",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({
        startBlockers: expect.arrayContaining([
          expect.objectContaining({ code: "triple-collision" }),
        ]),
      }),
    } satisfies Partial<ApiError>);

    expect(await catalogKeys(db!)).toMatchObject({
      specPropertyKey: FROM_KEY,
      dtsPropertyKey: FROM_KEY,
    });
  });

  it("start and finalize refuse an open version cutover without rewriting catalog", async () => {
    await seedRewritableBindingOnly(db!);
    await db!.query(
      `
      insert into parameter_spec_version_cutover_runs (
        id, organization_id, parameter_spec_id, from_version_id, to_version_id,
        status, created_by_user_id
      ) values (
        'run-pk-cutover-version-block', $1, $2, $3, $3, 'preparing', $4
      )
      `,
      [ORG_ID, SPEC_ID, `${SPEC_ID}:v1`, USER_ID],
    );

    await expect(
      startPropertyKeySourceCutover(db!, makeAuth(), {
        specId: SPEC_ID,
        propertyKey: TO_KEY,
        reason: "blocked by version cutover",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({
        startBlockers: expect.arrayContaining([
          expect.objectContaining({
            code: "open-version-cutover",
            details: expect.objectContaining({ runId: "run-pk-cutover-version-block" }),
          }),
        ]),
      }),
    } satisfies Partial<ApiError>);

    expect(await catalogKeys(db!)).toMatchObject({
      specPropertyKey: FROM_KEY,
      dtsPropertyKey: FROM_KEY,
    });

    await db!.query(
      `
      insert into parameter_spec_property_key_cutover_runs (
        id, organization_id, parameter_spec_id, from_key, to_key,
        status, created_by_user_id
      ) values (
        'run-pk-cutover-version-finalize', $1, $2, $3, $4, 'ready', $5
      )
      `,
      [ORG_ID, SPEC_ID, FROM_KEY, TO_KEY, USER_ID],
    );
    await rewriteOccurrenceToNewKey(db!);

    await expect(
      finalizePropertyKeySourceCutover(db!, makeAuth(), {
        specId: SPEC_ID,
        reason: "version cutover still open",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({
        startBlockers: expect.arrayContaining([
          expect.objectContaining({ code: "open-version-cutover" }),
        ]),
      }),
    } satisfies Partial<ApiError>);

    expect(await catalogKeys(db!)).toMatchObject({
      specPropertyKey: FROM_KEY,
      dtsPropertyKey: FROM_KEY,
    });
  });
});

describe.skipIf(!databaseAvailable)("property-key prepare trusted provenance (owned PostgreSQL)", () => {
  it("preflights a critical second location before any candidate, item, source, or success audit staging", async () => {
    await withTempDatabase({ prefix: "pkprov" }, async ({ db, connectionString }) => {
      const refusalRoot = createPostgresDatabase(connectionString);
      let primaryError: unknown;
      try {
        await db.query(`insert into organizations (id, name) values ($1, 'PK Cutover Org')`, [ORG_ID]);
        await db.query(
          `insert into users (id, organization_id, name, email, title, is_active)
           values ($1, $2, 'PK Cutover Admin', 'pk-cutover@example.com', 'Admin', true)`,
          [USER_ID, ORG_ID]
        );
        await seedSubject(db, SUBJECT_A, "subject-a");
        await seedSubject(db, SUBJECT_B, "subject-b");
        await seedSpec(db, { specId: SPEC_ID, subjectId: SUBJECT_A, propertyKey: FROM_KEY });
        const objectStore = createMemoryObjectStore();
        const putSpy = vi.spyOn(objectStore, "put");
        await seedRewritableBindingOnly(db, objectStore);
        putSpy.mockClear();

        await db.query(
          `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
           values ('ln-pk-cutover-critical', $1, $2, $3)`,
          [ORG_ID, PROJECT_ID, CONFIG_SET_ID]
        );
        await db.query(
          `insert into dts_logical_node_revisions (id, logical_node_id, config_revision_id, node_locator, name)
           values ('lnr-pk-cutover-critical', 'ln-pk-cutover-critical', $1, '/critical@7f', 'critical')`,
          [CONFIG_REVISION_ID]
        );
        await db.query(
          `insert into dts_node_occurrences (
             id, config_revision_id, file_version_id, name, labels, node_path,
             start_offset, end_offset, start_line, start_column, end_line, end_column,
             raw_text, ast_json, source_order
           ) values (
             'no-pk-cutover-critical', $1, $2, 'critical', '[]'::jsonb, '/soc/i2c@1/critical@7f',
             81, 140, 5, 1, 8, 2, 'node', '{}'::jsonb, 1
           )`,
          [CONFIG_REVISION_ID, FILE_VERSION_ID]
        );
        await db.query(
          `insert into dts_property_occurrences (
             id, config_revision_id, node_occurrence_id, file_version_id, property_name,
             start_offset, end_offset, start_line, start_column, end_line, end_column,
             raw_text, ast_json, source_order
           ) values (
             'po-pk-cutover-critical', $1, 'no-pk-cutover-critical', $2, $3,
             90, 108, 6, 3, 6, 20, '<2>', '{}'::jsonb, 1
           )`,
          [CONFIG_REVISION_ID, FILE_VERSION_ID, FROM_KEY]
        );
        await db.query(
          `insert into dts_occurrence_effects (
             id, config_revision_id, logical_node_revision_id, property_occurrence_id,
             node_occurrence_id, property_name, effect_kind, source_order
           ) values (
             'oe-pk-cutover-critical', $1, 'lnr-pk-cutover-critical', 'po-pk-cutover-critical',
             'no-pk-cutover-critical', $2, 'set', 2
           )`,
          [CONFIG_REVISION_ID, FROM_KEY]
        );
        await db.query(
          `insert into project_parameter_bindings (
             id, organization_id, project_id, parameter_spec_id, module_id, logical_node_id
           ) values ('zz-binding-pk-cutover-critical', $1, $2, $3, $4, 'ln-pk-cutover-critical')`,
          [ORG_ID, PROJECT_ID, SPEC_ID, MODULE_ID]
        );
        await db.query(
          `insert into project_parameter_binding_revisions (
             id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value
           ) values (
             'rev-pk-cutover-critical', 'zz-binding-pk-cutover-critical', $1, $2, '{}'::jsonb, '<2>'
           )`,
          [CONFIG_REVISION_ID, `${SPEC_ID}:v1`]
        );
        const twoLocationSource = `${BOARD_DTS.slice(0, -3)}\tsoc {\n\t\ti2c@1 {\n\t\t\tcritical@7f {\n\t\t\t\t${FROM_KEY} = <2>;\n\t\t\t};\n\t\t};\n\t};\n};\n`;
        const twoLocationStored = await objectStore.put({
          organizationId: ORG_ID,
          fileName: "board.dts",
          contentType: "text/plain",
          bytes: Buffer.from(twoLocationSource, "utf8")
        });
        await db.query(
          `update project_parameter_file_versions
           set storage_key = $2, checksum = $3, size_bytes = $4
           where id = $1`,
          [
            FILE_VERSION_ID,
            twoLocationStored.storageKey,
            twoLocationStored.checksumSha256,
            twoLocationStored.fileSizeBytes
          ]
        );
        await db.query(
          `insert into dts_nodes (id, file_version_id, name, node_path, compatible)
           values
             ('dts-node-pk-cutover-locked-safe', $1, 'charger', '/charger@6e', 'wiseeff,safe'),
             ('dts-node-pk-cutover-locked-parent', $1, 'i2c', '/soc/i2c@1', 'wiseeff,safe'),
             ('dts-node-pk-cutover-locked-critical', $1, 'critical', '/soc/i2c@1/critical@7f', 'wiseeff,locked-critical')`,
          [FILE_VERSION_ID]
        );
        const safeHeadStored = await objectStore.put({
          organizationId: ORG_ID,
          fileName: "board.dts",
          contentType: "text/plain",
          bytes: Buffer.from(twoLocationSource, "utf8")
        });
        await db.query(
          `insert into project_parameter_file_versions (
             id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin
           ) values (
             'fv-pk-cutover-safe-head', $1, 2, $2, $3, $4, '{}'::jsonb, 'upload'
           )`,
          [FILE_ID, safeHeadStored.storageKey, safeHeadStored.checksumSha256, safeHeadStored.fileSizeBytes]
        );
        await db.query(
          `insert into dts_nodes (id, file_version_id, name, node_path, compatible)
           values ('dts-node-pk-cutover-safe-head', 'fv-pk-cutover-safe-head', 'critical', '/soc/i2c@1/critical@7f', 'wiseeff,safe')`
        );
        await db.query(
          `update project_parameter_files set current_version_id = 'fv-pk-cutover-safe-head' where id = $1`,
          [FILE_ID]
        );
        putSpy.mockClear();
        await db.query(
          `insert into dts_sensitive_node_rules (
             id, organization_id, project_id, match_type, pattern, risk_tier, required_capability, enabled
           ) values (
             'rule-pk-cutover-critical', $1, $2, 'compatible', 'wiseeff,locked-critical',
             'critical', 'parameter:edit-critical', true
           )`,
          [ORG_ID, PROJECT_ID]
        );

        const principal = makeTestAuthContext({
          userId: USER_ID,
          organizationId: ORG_ID,
          name: "PK Cutover Admin",
          email: "pk-cutover@example.com",
          organizationName: "PK Cutover Org",
          permissions: [...makeAuth().permissions, "parameter:edit-critical"]
        });
        await startPropertyKeySourceCutover(db, principal, {
          specId: SPEC_ID,
          propertyKey: TO_KEY,
          reason: "critical second location"
        });
        const before = (
          await db.query<Record<string, string>>(
            `select
               (select status from parameter_spec_property_key_cutover_runs where parameter_spec_id = $1) as status,
               (select count(*)::text from parameter_spec_property_key_cutover_items) as items,
               (select count(*)::text from project_parameter_file_candidates) as candidates,
               (select current_version_id from project_parameter_files where id = '${FILE_ID}') as current_version,
               (select storage_key from project_parameter_file_versions where id = '${FILE_VERSION_ID}') as source_storage_key,
               (select checksum from project_parameter_file_versions where id = '${FILE_VERSION_ID}') as source_checksum,
               (select count(*)::text from audit_events where kind = 'parameter-topology-governance'
                 and action = 'spec-property-key-cutover-prepared') as success_audits`,
            [SPEC_ID]
          )
        ).rows[0];
        expect(before).toMatchObject({ status: "preparing", items: "2", candidates: "0", success_audits: "0" });

        const refusalSink = createTrustedRefusalAuditSink(refusalRoot);
        const agent = createAgentInvocation(principal, {
          sessionId: "session-cutover",
          toolCallId: "tool-cutover",
          approval: { required: true, approvalId: "approval-cutover" }
        });
        const system = createSystemInvocation({ kind: "service", name: "property-key-cutover-service" });
        for (const [requestId, invocation] of [
          ["cutover-agent-refusal", agent],
          ["cutover-system-refusal", system]
        ] as const) {
        await expect(
            preparePropertyKeySourceCutover(
              db,
              principal,
              { specId: SPEC_ID, reason: "must preflight all locations" },
              { invocation, requestId, refusalSink },
              { objectStore }
            )
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            status: 403,
            details: { code: "parameter-sensitive-node-human-required", requireHuman: true }
          });
          const after = (
            await db.query<Record<string, string>>(
              `select
                 (select status from parameter_spec_property_key_cutover_runs where parameter_spec_id = $1) as status,
                 (select count(*)::text from parameter_spec_property_key_cutover_items) as items,
                 (select count(*)::text from project_parameter_file_candidates) as candidates,
                 (select current_version_id from project_parameter_files where id = '${FILE_ID}') as current_version,
                 (select storage_key from project_parameter_file_versions where id = '${FILE_VERSION_ID}') as source_storage_key,
                 (select checksum from project_parameter_file_versions where id = '${FILE_VERSION_ID}') as source_checksum,
                 (select count(*)::text from audit_events where kind = 'parameter-topology-governance'
                   and action = 'spec-property-key-cutover-prepared') as success_audits`,
              [SPEC_ID]
            )
          ).rows[0];
          expect(after).toEqual(before);
          expect(putSpy).not.toHaveBeenCalled();
        }
        const refusalAudits = await db.query<{
          actor_type: string;
          actor_user_id: string | null;
          trace_id: string;
          metadata: Record<string, unknown>;
        }>(
          `select actor_type, actor_user_id, trace_id, metadata
           from audit_events
           where kind = 'parameter-sensitive-node-denied'
             and trace_id in ('cutover-agent-refusal', 'cutover-system-refusal')
           order by trace_id`
        );
        expect(refusalAudits.rows).toEqual([
          expect.objectContaining({
            actor_type: "agent",
            actor_user_id: USER_ID,
            trace_id: "cutover-agent-refusal",
            metadata: expect.objectContaining({
              initiator: "agent",
              sessionId: "session-cutover",
              toolCallId: "tool-cutover",
              approvalId: "approval-cutover"
            })
          }),
          expect.objectContaining({
            actor_type: "system",
            actor_user_id: null,
            trace_id: "cutover-system-refusal",
            metadata: expect.objectContaining({
              initiator: "system",
              systemKind: "service",
              systemName: "property-key-cutover-service"
            })
          })
        ]);
        await db.query(
          `update dts_nodes
           set compatible = case
             when node_path = '/soc/i2c@1' then 'wiseeff,locked-critical'
             when node_path = '/soc/i2c@1/critical@7f' then 'wiseeff,safe'
             else compatible
           end
           where file_version_id = $1`,
          [FILE_VERSION_ID]
        );
          await expect(
          assertTrustedSensitiveNodeWriteAllowed(db, principal, {
            organizationId: ORG_ID,
            projectId: PROJECT_ID,
            nodePath: "/soc/i2c@1/critical@7f",
            sourceFileName: "board.dts",
            sourceFileVersionId: FILE_VERSION_ID,
            sourcePath: { kind: "node-locator", value: "/soc/i2c@1/critical@7f" },
            invocation: createSystemInvocation({ kind: "job", name: "nested-cutover-reverse" }),
            requestId: "cutover-nested-reverse-system",
            refusalSink
          })
        ).resolves.toBeUndefined();
        expect(await db.query(
          `select count(*)::text as count from audit_events where trace_id = 'cutover-nested-reverse-system'`
        )).toMatchObject({ rows: [{ count: "0" }] });
        expect(await db.query<Record<string, string>>(
          `select
             (select status from parameter_spec_property_key_cutover_runs where parameter_spec_id = $1) as status,
             (select count(*)::text from parameter_spec_property_key_cutover_items) as items,
             (select count(*)::text from project_parameter_file_candidates) as candidates,
             (select current_version_id from project_parameter_files where id = '${FILE_ID}') as current_version,
             (select storage_key from project_parameter_file_versions where id = '${FILE_VERSION_ID}') as source_storage_key,
             (select checksum from project_parameter_file_versions where id = '${FILE_VERSION_ID}') as source_checksum,
             (select count(*)::text from audit_events where kind = 'parameter-topology-governance'
               and action = 'spec-property-key-cutover-prepared') as success_audits`,
          [SPEC_ID]
        )).toMatchObject({ rows: [before] });
        expect(putSpy).not.toHaveBeenCalled();
        await db.query(
          `update dts_nodes
           set compatible = null
           where file_version_id = $1 and node_path = '/soc/i2c@1/critical@7f'`,
          [FILE_VERSION_ID],
        );
        await expect(
          assertTrustedSensitiveNodeWriteAllowed(db, principal, {
            organizationId: ORG_ID,
            projectId: PROJECT_ID,
            nodePath: "/soc/i2c@1/critical@7f",
            sourceFileName: "board.dts",
            sourceFileVersionId: FILE_VERSION_ID,
            sourcePath: { kind: "node-locator", value: "/soc/i2c@1/critical@7f" },
            invocation: createSystemInvocation({ kind: "service", name: "nested-cutover-null-compatible" }),
            requestId: "cutover-null-compatible",
            refusalSink,
          }),
        ).resolves.toBeUndefined();
        expect(
          (await db.query(`select 1 from audit_events where trace_id = 'cutover-null-compatible'`)).rows,
        ).toEqual([]);
        expect(putSpy).not.toHaveBeenCalled();
        await db.query(
          `update dts_nodes
           set compatible = case
             when node_path = '/soc/i2c@1' then 'wiseeff,safe'
             when node_path = '/soc/i2c@1/critical@7f' then 'wiseeff,locked-critical'
             else compatible
           end
           where file_version_id = $1`,
          [FILE_VERSION_ID]
        );
        await db.query(
          `create or replace function fail_cutover_prepare_audit() returns trigger as $$
           begin
             if new.kind = 'parameter-topology-governance'
                and new.action = 'spec-property-key-cutover-prepared' then
               raise exception 'injected cutover prepare audit failure';
             end if;
             return new;
           end;
           $$ language plpgsql`
        );
        await db.query(
          `create trigger fail_cutover_prepare_audit_trigger
           before insert on audit_events
           for each row execute function fail_cutover_prepare_audit()`
        );
        await expect(
          preparePropertyKeySourceCutover(
            db,
            principal,
            { specId: SPEC_ID, reason: "audit failure must roll back staging" },
            {
              invocation: createUserInvocation(principal),
              requestId: "cutover-audit-failure",
              refusalSink
            },
            { objectStore }
          )
        ).rejects.toThrow("injected cutover prepare audit failure");
        const afterAuditFailure = (
          await db.query<Record<string, string>>(
            `select
               (select status from parameter_spec_property_key_cutover_runs where parameter_spec_id = $1) as status,
               (select count(*)::text from parameter_spec_property_key_cutover_items) as items,
               (select count(*)::text from project_parameter_file_candidates) as candidates,
               (select current_version_id from project_parameter_files where id = '${FILE_ID}') as current_version,
               (select storage_key from project_parameter_file_versions where id = '${FILE_VERSION_ID}') as source_storage_key,
               (select checksum from project_parameter_file_versions where id = '${FILE_VERSION_ID}') as source_checksum,
               (select count(*)::text from audit_events where kind = 'parameter-topology-governance'
                 and action = 'spec-property-key-cutover-prepared') as success_audits`,
            [SPEC_ID]
          )
        ).rows[0];
        expect(afterAuditFailure).toEqual(before);
        expect(putSpy).toHaveBeenCalledTimes(1);
        await db.query(`drop trigger fail_cutover_prepare_audit_trigger on audit_events`);
        await db.query(`drop function fail_cutover_prepare_audit()`);
        await db.query(`update dts_sensitive_node_rules set risk_tier = 'high' where id = 'rule-pk-cutover-critical'`);
        putSpy.mockClear();
        const systemPrepared = await preparePropertyKeySourceCutover(
          db,
          principal,
          { specId: SPEC_ID, reason: "high risk preserves System provenance" },
          {
            invocation: createSystemInvocation({ kind: "service", name: "property-key-high-service" }),
            requestId: "cutover-high-system",
            refusalSink
          },
          { objectStore }
        );
        expect(systemPrepared.item.status).toBe("ready");
        expect(putSpy).toHaveBeenCalledTimes(1);
        const systemCandidateAttribution = await db.query<{ created_by_user_id: string | null }>(
          `select created_by_user_id from project_parameter_file_candidates`
        );
        expect(systemCandidateAttribution.rows).toEqual([{ created_by_user_id: null }]);
        const systemSuccessAudit = await db.query<{
          actor_type: string;
          actor_user_id: string | null;
          trace_id: string;
          metadata: Record<string, unknown>;
        }>(
          `select actor_type, actor_user_id, trace_id, metadata
           from audit_events where trace_id = 'cutover-high-system'`
        );
        expect(systemSuccessAudit.rows).toHaveLength(2);
        expect(systemSuccessAudit.rows).toEqual(
          expect.arrayContaining([expect.objectContaining({
            actor_type: "system",
            actor_user_id: null,
            trace_id: "cutover-high-system",
            metadata: expect.objectContaining({
              initiator: "system",
              systemKind: "service",
              systemName: "property-key-high-service"
            })
          })])
        );
        expect(systemSuccessAudit.rows.every((row) => row.actor_type === "system" && row.actor_user_id === null)).toBe(true);
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        try {
          await refusalRoot.close();
        } catch (cleanupError) {
          if (primaryError === undefined) throw cleanupError;
        }
      }
    });
  });
});

describe.skipIf(!databaseAvailable)("property-key source cutover prepare staging (ADR-0034 / TD-117)", () => {
  let db: InMemoryTestDatabase | null = null;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await db.query(`insert into organizations (id, name) values ($1, 'PK Cutover Org')`, [ORG_ID]);
    await db.query(
      `insert into users (id, organization_id, name, email, title, is_active)
       values ($1, $2, 'PK Cutover Admin', 'pk-cutover@example.com', 'Admin', true)`,
      [USER_ID, ORG_ID],
    );
    await seedSubject(db, SUBJECT_A, "subject-a");
    await seedSubject(db, SUBJECT_B, "subject-b");
    await seedSpec(db, { specId: SPEC_ID, subjectId: SUBJECT_A, propertyKey: FROM_KEY });
  });

  afterEach(async () => {
    if (db) {
      await db.rollback();
      db = null;
    }
  });

  it("prepare stages a file-candidate rewrite without writing live source or catalog", async () => {
    const objectStore = createMemoryObjectStore();
    await seedRewritableBindingOnly(db!, objectStore);

    await startPropertyKeySourceCutover(db!, makeAuth(), {
      specId: SPEC_ID,
      propertyKey: TO_KEY,
      reason: "stage source rewrite",
    });

    const prepared = await preparePropertyKeySourceCutover(
      db!,
      makeAuth(),
      { specId: SPEC_ID, reason: "stage drafts" },
      createTestParameterSubmissionContext(makeAuth(), "property-key-prepare-stage"),
      { objectStore },
    );

    expect(prepared.item).toMatchObject({
      parameterSpecId: SPEC_ID,
      status: "ready",
      writesCatalog: false,
      writesSource: false,
      stagedSource: true,
    });
    expect(prepared.item.items).toEqual([
      expect.objectContaining({
        bindingId: BINDING_WITH_OCCURRENCE,
        status: "ready",
        locationStatus: "would-rewrite",
        stagedRewrite: expect.objectContaining({
          kind: "file-candidate",
          status: "ready",
        }),
        fileId: FILE_ID,
        configSetId: CONFIG_SET_ID,
      }),
    ]);

    const candidateId = prepared.item.items[0]?.stagedRewrite?.id;
    expect(candidateId).toBeTruthy();
    const candidate = await getParameterFileCandidateById(db!, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      candidateId: candidateId!,
    });
    expect(candidate?.fileId).toBe(FILE_ID);
    expect(candidate?.status).toBe("ready");
    const candidateBytes = await objectStore.get(candidate!.storageKey!);
    expect(candidateBytes.toString("utf8")).toContain(`${TO_KEY} = <1>`);
    expect(candidateBytes.toString("utf8")).not.toContain(FROM_KEY);

    const liveFile = await getProjectParameterFileById(db!, {
      organizationId: ORG_ID,
      fileId: FILE_ID,
    });
    expect(liveFile?.currentVersionId).toBe(FILE_VERSION_ID);
    expect(await catalogKeys(db!)).toMatchObject({
      specPropertyKey: FROM_KEY,
      dtsPropertyKey: FROM_KEY,
    });

    expect(prepared.item.items[0]).toMatchObject({
      fileId: FILE_ID,
      fileName: "board.dts",
    });

    await expect(
      finalizePropertyKeySourceCutover(db!, makeAuth(), {
        specId: SPEC_ID,
        reason: "candidate is not live yet",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({ blockingItems: 1 }),
    } satisfies Partial<ApiError>);

    await rewriteOccurrenceToNewKey(db!);
    const finalized = await finalizePropertyKeySourceCutover(db!, makeAuth(), {
      specId: SPEC_ID,
      reason: "human merged the candidate into live source",
    });
    expect(finalized.item.status).toBe("finalized");
    expect(await catalogKeys(db!)).toMatchObject({
      specPropertyKey: TO_KEY,
      dtsPropertyKey: TO_KEY,
    });
  });

  it("GET reflects live candidate status after activate and still keeps catalog closed until finalize", async () => {
    const objectStore = createMemoryObjectStore();
    await seedRewritableBindingOnly(db!, objectStore);
    await startPropertyKeySourceCutover(db!, makeAuth(), {
      specId: SPEC_ID,
      propertyKey: TO_KEY,
      reason: "stage source rewrite",
    });
    const prepared = await preparePropertyKeySourceCutover(
      db!,
      makeAuth(),
      { specId: SPEC_ID, reason: "stage drafts" },
      createTestParameterSubmissionContext(makeAuth(), "property-key-prepare-status"),
      { objectStore },
    );
    const candidateId = prepared.item.items[0]?.stagedRewrite?.id;
    expect(candidateId).toBeTruthy();

    await expect(
      finalizePropertyKeySourceCutover(db!, makeAuth(), {
        specId: SPEC_ID,
        reason: "activate has not happened",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    } satisfies Partial<ApiError>);

    await activateCandidate(db!, objectStore, makeAuth(), {
      projectId: PROJECT_ID,
      candidateId: candidateId!,
      expectedCurrentVersionId: FILE_VERSION_ID,
    });

    const opened = await getOpenPropertyKeySourceCutover(db!, makeAuth(), SPEC_ID);
    expect(opened.item.items[0]).toMatchObject({
      fileId: FILE_ID,
      configSetId: CONFIG_SET_ID,
      fileName: "board.dts",
      stagedRewrite: {
        kind: "file-candidate",
        id: candidateId,
        status: "active",
      },
    });
    expect(await catalogKeys(db!)).toMatchObject({
      specPropertyKey: FROM_KEY,
      dtsPropertyKey: FROM_KEY,
    });

    const repreview = await previewPropertyKeySourceCutover(db!, makeAuth(), {
      specId: SPEC_ID,
      propertyKey: TO_KEY,
    });
    if (!repreview.item.locations.every((location) => location.status === "already-new-key")) {
      await expect(
        finalizePropertyKeySourceCutover(db!, makeAuth(), {
          specId: SPEC_ID,
          reason: "live occurrence still on the old key",
        }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
      } satisfies Partial<ApiError>);
      await rewriteOccurrenceToNewKey(db!);
    }

    const finalized = await finalizePropertyKeySourceCutover(db!, makeAuth(), {
      specId: SPEC_ID,
      reason: "source already uses the new key",
    });
    expect(finalized.item.status).toBe("finalized");
    expect(await catalogKeys(db!)).toMatchObject({
      specPropertyKey: TO_KEY,
      dtsPropertyKey: TO_KEY,
    });
  });

  it("prepare fails closed on triple-collision without staging a candidate", async () => {
    const objectStore = createMemoryObjectStore();
    await seedRewritableBindingOnly(db!, objectStore);
    await startPropertyKeySourceCutover(db!, makeAuth(), {
      specId: SPEC_ID,
      propertyKey: TO_KEY,
      reason: "start before collision appears",
    });
    await seedSpec(db!, {
      specId: BLOCKER_ID,
      subjectId: SUBJECT_A,
      propertyKey: TO_KEY,
      specificationKey: `manual/${TO_KEY}-blocker`,
      lifecycle: "deprecated",
    });

    await expect(
      preparePropertyKeySourceCutover(
        db!,
        makeAuth(),
        { specId: SPEC_ID, reason: "collision now present" },
        createTestParameterSubmissionContext(makeAuth(), "property-key-prepare-collision"),
        { objectStore },
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({
        startBlockers: expect.arrayContaining([
          expect.objectContaining({ code: "triple-collision" }),
        ]),
      }),
    } satisfies Partial<ApiError>);

    const candidates = await db!.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_file_candidates where project_id = $1`,
      [PROJECT_ID],
    );
    expect(Number(candidates.rows[0]?.count ?? 0)).toBe(0);
    expect(await catalogKeys(db!)).toMatchObject({
      specPropertyKey: FROM_KEY,
      dtsPropertyKey: FROM_KEY,
    });
  });

  it("prepare marks a missing node path incompatible and does not stage a candidate", async () => {
    const objectStore = createMemoryObjectStore();
    await seedRewritableBindingOnly(db!, objectStore);
    await db!.query(`update dts_node_occurrences set node_path = '' where id = 'no-pk-cutover'`);

    await startPropertyKeySourceCutover(db!, makeAuth(), {
      specId: SPEC_ID,
      propertyKey: TO_KEY,
      reason: "stage without node path",
    });

    const prepared = await preparePropertyKeySourceCutover(
      db!,
      makeAuth(),
      { specId: SPEC_ID, reason: "missing node path" },
      createTestParameterSubmissionContext(makeAuth(), "property-key-prepare-missing-path"),
      { objectStore },
    );

    expect(prepared.item).toMatchObject({
      status: "preparing",
      writesCatalog: false,
      writesSource: false,
      stagedSource: false,
    });
    expect(prepared.item.items).toEqual([
      expect.objectContaining({
        bindingId: BINDING_WITH_OCCURRENCE,
        status: "incompatible",
        incompatibilityCode: "missing-node-path",
      }),
    ]);
    const candidates = await db!.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_file_candidates where project_id = $1`,
      [PROJECT_ID],
    );
    expect(Number(candidates.rows[0]?.count ?? 0)).toBe(0);
    expect(await catalogKeys(db!)).toMatchObject({
      specPropertyKey: FROM_KEY,
      dtsPropertyKey: FROM_KEY,
    });
  });
});

describe.skipIf(!databaseAvailable)("property-key exact-node provenance repair", () => {
  it(
    "fails closed when the second location's exact node is missing even though its parent exists",
    async () => {
      await withTempDatabase({ prefix: "pkmissingnode" }, async ({ db, connectionString }) => {
        const refusalRoot = createPostgresDatabase(connectionString);
        let primaryError: unknown;
        try {
          await db.query(`insert into organizations (id, name) values ($1, 'PK Cutover Org')`, [ORG_ID]);
          await db.query(
            `insert into users (id, organization_id, name, email, title, is_active)
             values ($1, $2, 'PK Cutover Admin', 'pk-cutover@example.com', 'Admin', true)`,
            [USER_ID, ORG_ID],
          );
          await seedSubject(db, SUBJECT_A, "subject-a");
          await seedSubject(db, SUBJECT_B, "subject-b");
          await seedSpec(db, { specId: SPEC_ID, subjectId: SUBJECT_A, propertyKey: FROM_KEY });
          const objectStore = createMemoryObjectStore();
          const putSpy = vi.spyOn(objectStore, "put");
          await seedRewritableBindingOnly(db, objectStore);
          const twoLocationSource = `${BOARD_DTS.slice(0, -3)}\tsoc {\n\t\ti2c@1 {\n\t\t\tcritical@7f {\n\t\t\t\t${FROM_KEY} = <2>;\n\t\t\t};\n\t\t};\n\t};\n};\n`;
          const stored = await objectStore.put({
            organizationId: ORG_ID,
            fileName: "board.dts",
            contentType: "text/plain",
            bytes: Buffer.from(twoLocationSource, "utf8"),
          });
          await db.query(
            `update project_parameter_file_versions
             set storage_key = $2, checksum = $3, size_bytes = $4
             where id = $1`,
            [FILE_VERSION_ID, stored.storageKey, stored.checksumSha256, stored.fileSizeBytes],
          );
          putSpy.mockClear();

          await db.query(
            `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
             values ('ln-pk-cutover-missing-child', $1, $2, $3)`,
            [ORG_ID, PROJECT_ID, CONFIG_SET_ID],
          );
          await db.query(
            `insert into dts_logical_node_revisions (id, logical_node_id, config_revision_id, node_locator, name)
             values ('lnr-pk-cutover-missing-child', 'ln-pk-cutover-missing-child', $1, '/critical@7f', 'critical')`,
            [CONFIG_REVISION_ID],
          );
          await db.query(
            `insert into dts_node_occurrences (
               id, config_revision_id, file_version_id, name, labels, node_path,
               start_offset, end_offset, start_line, start_column, end_line, end_column,
               raw_text, ast_json, source_order
             ) values (
               'no-pk-cutover-missing-child', $1, $2, 'critical', '[]'::jsonb,
               '/soc/i2c@1/critical@7f', 81, 140, 5, 1, 8, 2, 'node', '{}'::jsonb, 2
             )`,
            [CONFIG_REVISION_ID, FILE_VERSION_ID],
          );
          await db.query(
            `insert into dts_property_occurrences (
               id, config_revision_id, node_occurrence_id, file_version_id, property_name,
               start_offset, end_offset, start_line, start_column, end_line, end_column,
               raw_text, ast_json, source_order
             ) values (
               'po-pk-cutover-missing-child', $1, 'no-pk-cutover-missing-child', $2, $3,
               90, 108, 6, 5, 6, 22, '<2>', '{}'::jsonb, 2
             )`,
            [CONFIG_REVISION_ID, FILE_VERSION_ID, FROM_KEY],
          );
          await db.query(
            `insert into dts_occurrence_effects (
               id, config_revision_id, logical_node_revision_id, property_occurrence_id,
               node_occurrence_id, property_name, effect_kind, source_order
             ) values (
               'oe-pk-cutover-missing-child', $1, 'lnr-pk-cutover-missing-child',
               'po-pk-cutover-missing-child', 'no-pk-cutover-missing-child', $2, 'set', 2
             )`,
            [CONFIG_REVISION_ID, FROM_KEY],
          );
          await db.query(
            `insert into project_parameter_bindings (
               id, organization_id, project_id, parameter_spec_id, module_id, logical_node_id
             ) values ('zz-binding-pk-cutover-missing-child', $1, $2, $3, $4, 'ln-pk-cutover-missing-child')`,
            [ORG_ID, PROJECT_ID, SPEC_ID, MODULE_ID],
          );
          await db.query(
            `insert into project_parameter_binding_revisions (
               id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value
             ) values (
               'rev-pk-cutover-missing-child', 'zz-binding-pk-cutover-missing-child', $1, $2, '{}'::jsonb, '<2>')`,
            [CONFIG_REVISION_ID, `${SPEC_ID}:v1`],
          );
          // The parent exists and is safe; the exact child row is intentionally absent.
          await db.query(
            `insert into dts_nodes (id, file_version_id, name, node_path, compatible)
             values ('dts-node-pk-cutover-missing-parent', $1, 'i2c', '/soc/i2c@1', 'wiseeff,safe')`,
            [FILE_VERSION_ID],
          );
          await db.query(
            `insert into dts_sensitive_node_rules (
               id, organization_id, project_id, match_type, pattern, risk_tier, required_capability, enabled
             ) values (
               'rule-pk-cutover-missing-child', $1, $2, 'compatible', 'wiseeff,child-critical',
               'critical', 'parameter:edit-critical', true
             )`,
            [ORG_ID, PROJECT_ID],
          );

          const principal = makeTestAuthContext({
            userId: USER_ID,
            organizationId: ORG_ID,
            name: "PK Cutover Admin",
            email: "pk-cutover@example.com",
            organizationName: "PK Cutover Org",
            permissions: [...makeAuth().permissions, "parameter:edit-critical"],
          });
          await startPropertyKeySourceCutover(db, principal, {
            specId: SPEC_ID,
            propertyKey: TO_KEY,
            reason: "missing exact child",
          });
          const before = (
            await db.query<Record<string, string>>(
              `select
                 (select status from parameter_spec_property_key_cutover_runs where parameter_spec_id = $1) as status,
                 (select count(*)::text from parameter_spec_property_key_cutover_items) as items,
                 (select count(*)::text from project_parameter_file_candidates) as candidates,
                 (select current_version_id from project_parameter_files where id = $2) as current_version,
                 (select storage_key from project_parameter_file_versions where id = $3) as source_storage_key,
                 (select checksum from project_parameter_file_versions where id = $3) as source_checksum,
                 (select count(*)::text from audit_events where kind = 'parameter-topology-governance'
                   and action = 'spec-property-key-cutover-prepared') as success_audits`,
              [SPEC_ID, FILE_ID, FILE_VERSION_ID],
            )
          ).rows[0];
          expect(before).toMatchObject({ status: "preparing", items: "2", candidates: "0", success_audits: "0" });

          const invocation = createAgentInvocation(principal, {
            sessionId: "session-missing-child",
            toolCallId: "tool-missing-child",
            approval: { required: true, approvalId: "approval-missing-child" },
          });
          await expect(
            preparePropertyKeySourceCutover(
              db,
              principal,
              { specId: SPEC_ID, reason: "missing exact child must fail closed" },
              {
                invocation,
                requestId: "cutover-missing-child",
                refusalSink: createTrustedRefusalAuditSink(refusalRoot),
              },
              { objectStore },
            ),
          ).rejects.toMatchObject({
            code: "CONFLICT",
            status: 409,
            details: { code: "parameter-sensitive-node-identity-mismatch" },
          });

          const after = (
            await db.query<Record<string, string>>(
              `select
                 (select status from parameter_spec_property_key_cutover_runs where parameter_spec_id = $1) as status,
                 (select count(*)::text from parameter_spec_property_key_cutover_items) as items,
                 (select count(*)::text from project_parameter_file_candidates) as candidates,
                 (select current_version_id from project_parameter_files where id = $2) as current_version,
                 (select storage_key from project_parameter_file_versions where id = $3) as source_storage_key,
                 (select checksum from project_parameter_file_versions where id = $3) as source_checksum,
                 (select count(*)::text from audit_events where kind = 'parameter-topology-governance'
                   and action = 'spec-property-key-cutover-prepared') as success_audits`,
              [SPEC_ID, FILE_ID, FILE_VERSION_ID],
            )
          ).rows[0];
          expect(after).toEqual(before);
          expect(putSpy).not.toHaveBeenCalled();
          expect(
            (await db.query(`select 1 from audit_events where trace_id = 'cutover-missing-child'`)).rows,
          ).toEqual([]);
        } catch (error) {
          primaryError = error;
          throw error;
        } finally {
          try {
            await refusalRoot.close();
          } catch (cleanupError) {
            if (primaryError === undefined) throw cleanupError;
          }
        }
      });
    },
    90_000,
  );
});
