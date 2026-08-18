/**
 * TD-117 / ADR-0034 first slice: referenced property-key rename stays refused,
 * and a read-only source-cutover preview lists rewrite locations without
 * writing the catalog triple.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { ApiError } from "../../shared/http/errors";
import { getParameterFileCandidateById } from "../parameter-files/candidateRepository";
import { getProjectParameterFileById } from "../parameter-files/repository";
import {
  finalizePropertyKeySourceCutover,
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

async function seedSubject(db: InMemoryTestDatabase, id: string, sourceKey: string) {
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
  db: InMemoryTestDatabase,
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
  db: InMemoryTestDatabase,
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
  db: InMemoryTestDatabase,
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
      {},
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
        {},
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
});
