/**
 * Round 5 P1-2: cross-tenant review evidence integrity (resolve + 0055 backfill).
 */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createDatabase, type Database } from "../../shared/database/client";
import { getPendingMigrations } from "../../shared/database/migrations";
import { ApiError } from "../../shared/http/errors";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../parameter-topology/types";
import { backfillReviewTaskScopeColumns } from "./repository";
import { resolveSpecReviewTask } from "./service";

const ORG_A = "org-tenant-evidence-a";
const ORG_B = "org-tenant-evidence-b";
const PROJECT_A = "project-tenant-evidence-a";
const PROJECT_B = "project-tenant-evidence-b";
const USER_ID = "user-tenant-evidence";
const CONFIG_SET_A = "dcs-tenant-evidence-a";
const CONFIG_SET_B = "dcs-tenant-evidence-b";
const SPEC_A = "pspec:manual:tenant_mystery";
const SPEC_A_VERSION = "psv:manual:tenant_mystery:v1";
const PROPERTY_KEY = "tenant_mystery";

const UNMATCHED_DTS = `/dts-v1/;

/ {
	amba {
		compatible = "wiseeff,ghost-device";
		${PROPERTY_KEY} = <1>;
	};
};
`;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationsDir = path.join(projectRoot, "server", "migrations");
const migration0055 = "0055_parameter_spec_review_task_scope_backfill.sql";
const migration0057 = "0057_parameter_spec_review_task_scope_reconcile.sql";
const migration0058 = "0058_parameter_spec_review_task_scope_evidence_only.sql";

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(orgId = ORG_A): AuthContext {
  return {
    user: {
      id: USER_ID,
      organizationId: orgId,
      name: "Tenant Evidence Admin",
      email: "tenant-evidence@example.com",
      title: "Admin",
      isActive: true,
    },
    organization: { id: orgId, name: "Tenant Evidence Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  };
}

function resolveTestDatabaseUrl() {
  return (
    process.env.TEST_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff"
  );
}

function adminConnectionString(database = "postgres") {
  const url = new URL(resolveTestDatabaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

async function withAdminClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminConnectionString("postgres") });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function withTempDatabase(fn: (db: Database) => Promise<void>) {
  const dbName = `wiseeff_mig0055_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`.replace(
    /[^a-z0-9_]/gi,
    "",
  );
  await withAdminClient(async (admin) => {
    await admin.query(`create database ${dbName}`);
  });

  const connectionString = adminConnectionString(dbName);
  const client = new pg.Client({ connectionString });
  await client.connect();
  const db = createDatabase({
    query: async (text, values = []) => {
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    },
  });

  try {
    await fn(db);
  } finally {
    await client.end().catch(() => undefined);
    await withAdminClient(async (admin) => {
      await admin.query(`drop database if exists ${dbName} with (force)`);
    });
  }
}

async function applyMigrationsThrough(db: Database, maxInclusive: string): Promise<string[]> {
  await db.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const limited = files.filter((file) => file <= maxInclusive);
  const applied = await db.query<{ name: string }>("select name from schema_migrations order by name");
  const pending = getPendingMigrations(
    limited,
    applied.rows.map((row) => row.name),
  );

  for (const file of pending) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await db.query("begin");
    try {
      await db.query(sql);
      await db.query("insert into schema_migrations (name) values ($1)", [file]);
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  }

  return pending;
}

async function applySingleMigration(db: Database, file: string) {
  const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
  await db.query("begin");
  try {
    await db.query(sql);
    await db.query(
      `insert into schema_migrations (name) values ($1) on conflict (name) do nothing`,
      [file],
    );
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function seedGraph(db: InMemoryTestDatabase | Database) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'Org A'), ($2, 'Org B')
     on conflict (id) do update set name = excluded.name`,
    [ORG_A, ORG_B],
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, $2, 'Tenant Evidence Admin', 'tenant-evidence@example.com', 'Admin', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
    [USER_ID, ORG_A],
  );
  for (const [projectId, orgId, configSetId, code] of [
    [PROJECT_A, ORG_A, CONFIG_SET_A, "TEA"],
    [PROJECT_B, ORG_B, CONFIG_SET_B, "TEB"],
  ] as const) {
    await db.query(
      `
      insert into projects (id, organization_id, name, code, status)
      values ($1, $2, $3, $4, 'initialized')
      on conflict (id) do update set organization_id = excluded.organization_id
      `,
      [projectId, orgId, `Tenant Evidence ${code}`, code],
    );
    await db.query(
      `
      insert into dts_config_set (id, organization_id, project_id, name, description)
      values ($1, $2, $3, 'tenant-set', 'tenant evidence fixture')
      on conflict (id) do update set organization_id = excluded.organization_id
      `,
      [configSetId, orgId, projectId],
    );
  }
  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key)
    values ($1, $2, 'manual', 'manual/tenant_mystery')
    on conflict (id) do nothing
    `,
    [SPEC_A, ORG_A],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle
    ) values ($1, $2, 1, 'tenant_mystery', 'Manual tenant mystery', '{"kind":"cells"}'::jsonb, null, null, 'active')
    on conflict (id) do nothing
    `,
    [SPEC_A_VERSION, SPEC_A],
  );
  await db.query(
    `
    insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, constraints, documentation)
    values ($1, $2, $3, 'manual', '{"cells": 1}'::jsonb, 'Tenant mystery spec for resolve tests')
    on conflict (id) do nothing
    `,
    [`dps-${SPEC_A}`, SPEC_A, PROPERTY_KEY],
  );
}

async function insertPinnedMember(
  db: InMemoryTestDatabase | Database,
  input: {
    orgId: string;
    projectId: string;
    configSetId: string;
    fileId: string;
    fileName: string;
    versionId: string;
    content: string;
  },
) {
  const checksum = createHash("sha256").update(input.content, "utf8").digest("hex");
  await db.query(
    `
    insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled,
      config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, $4, 'dts', true, $5, 'base', 0)
    on conflict (id) do nothing
    `,
    [input.fileId, input.orgId, input.projectId, input.fileName, input.configSetId],
  );
  await db.query(
    `
    insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload', $6)
    on conflict (id) do nothing
    `,
    [
      input.versionId,
      input.fileId,
      `${input.orgId}/${checksum}-${input.fileName}`,
      checksum,
      Buffer.byteLength(input.content, "utf8"),
      USER_ID,
    ],
  );
  await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
    input.versionId,
    input.fileId,
  ]);
}

function manifest(
  orgId: string,
  projectId: string,
  configSetId: string,
  versionId: string,
  fileId: string,
): ConfigRevisionManifest {
  return {
    organizationId: orgId,
    projectId,
    configSetId,
    entryFile: "ghost.dts",
    includeSearchPaths: ["."],
    overlayOrder: [],
    members: [
      {
        fileId,
        fileVersionId: versionId,
        fileName: "ghost.dts",
        role: "base",
        sortOrder: 0,
        content: UNMATCHED_DTS,
      },
    ],
  };
}

type TopologyFixture = {
  revisionId: string;
  propertyOccurrenceId: string;
  logicalNodeId: string;
  nodeLocator: string;
  compatible: string[];
  fileVersionId: string;
};

async function ingestOrgARevision(db: InMemoryTestDatabase): Promise<TopologyFixture> {
  const fileId = "file-tenant-a";
  const versionId = "fv-tenant-a-1";
  await insertPinnedMember(db, {
    orgId: ORG_A,
    projectId: PROJECT_A,
    configSetId: CONFIG_SET_A,
    fileId,
    fileName: "ghost.dts",
    versionId,
    content: UNMATCHED_DTS,
  });
  const revision = await ingestConfigRevision(
    db,
    manifest(ORG_A, PROJECT_A, CONFIG_SET_A, versionId, fileId),
    makeAuth(ORG_A),
  );
  const task = await db.query<{
    source_evidence: Record<string, unknown>;
  }>(
    `
    select source_evidence
    from parameter_spec_review_tasks
    where organization_id = $1 and status = 'open'
    limit 1
    `,
    [ORG_A],
  );
  const evidence = task.rows[0]!.source_evidence;
  return {
    revisionId: revision.id,
    propertyOccurrenceId: String(evidence.propertyOccurrenceId),
    logicalNodeId: String(evidence.logicalNodeId),
    nodeLocator: String(evidence.nodeLocator),
    compatible: Array.isArray(evidence.compatible) ? evidence.compatible.map(String) : [],
    fileVersionId: versionId,
  };
}

async function ingestOrgBRevision(db: InMemoryTestDatabase): Promise<TopologyFixture> {
  const fileId = "file-tenant-b";
  const versionId = "fv-tenant-b-1";
  await insertPinnedMember(db, {
    orgId: ORG_B,
    projectId: PROJECT_B,
    configSetId: CONFIG_SET_B,
    fileId,
    fileName: "ghost-b.dts",
    versionId,
    content: UNMATCHED_DTS,
  });
  const revision = await ingestConfigRevision(
    db,
    manifest(ORG_B, PROJECT_B, CONFIG_SET_B, versionId, fileId),
    makeAuth(ORG_B),
  );
  const task = await db.query<{ source_evidence: Record<string, unknown> }>(
    `
    select source_evidence
    from parameter_spec_review_tasks
    where organization_id = $1 and status = 'open'
    limit 1
    `,
    [ORG_B],
  );
  const evidence = task.rows[0]!.source_evidence;
  return {
    revisionId: revision.id,
    propertyOccurrenceId: String(evidence.propertyOccurrenceId),
    logicalNodeId: String(evidence.logicalNodeId),
    nodeLocator: String(evidence.nodeLocator),
    compatible: Array.isArray(evidence.compatible) ? evidence.compatible.map(String) : [],
    fileVersionId: versionId,
  };
}

async function insertCrossTenantTask(
  db: InMemoryTestDatabase,
  evidence: Record<string, unknown>,
): Promise<string> {
  const taskId = randomUUID();
  await db.query(
    `
    insert into parameter_spec_review_tasks (
      id, organization_id, source_evidence, candidate_schemas, project_count, status
    ) values ($1, $2, $3::jsonb, '[]'::jsonb, 1, 'open')
    `,
    [taskId, ORG_A, JSON.stringify(evidence)],
  );
  return taskId;
}

async function pollutionCounts(db: InMemoryTestDatabase) {
  const [bindings, overrides, decisions, audits] = await Promise.all([
    db.query<{ count: string }>(`select count(*)::text as count from project_parameter_bindings`),
    db.query<{ count: string }>(
      `select count(*)::text as count from parameter_spec_matcher_overrides`,
    ),
    db.query<{ count: string }>(
      `select count(*)::text as count from dts_property_occurrence_spec_decisions`,
    ),
    db.query<{ count: string }>(
      `select count(*)::text as count from audit_events where action like 'spec-review-%'`,
    ),
  ]);
  return {
    bindings: Number(bindings.rows[0]?.count ?? 0),
    overrides: Number(overrides.rows[0]?.count ?? 0),
    decisions: Number(decisions.rows[0]?.count ?? 0),
    audits: Number(audits.rows[0]?.count ?? 0),
  };
}

describe.skipIf(!databaseAvailable)("spec review tenant evidence integration", () => {
  let db: InMemoryTestDatabase | null = null;
  let orgA: TopologyFixture;
  let orgB: TopologyFixture;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedGraph(db);
    orgA = await ingestOrgARevision(db);
    orgB = await ingestOrgBRevision(db);
  });

  afterEach(async () => {
    if (db) {
      await db.rollback();
      db = null;
    }
  });

  async function expectResolveBlocked(taskId: string) {
    const before = await pollutionCounts(db!);
    await expect(
      resolveSpecReviewTask(db!, makeAuth(ORG_A), {
        taskId,
        decision: "resolved",
        parameterSpecId: SPEC_A,
        reason: "cross tenant attempt",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 } satisfies Partial<ApiError>);

    const task = await db!.query<{ status: string }>(
      `select status from parameter_spec_review_tasks where id = $1`,
      [taskId],
    );
    expect(task.rows[0]?.status).toBe("open");

    const after = await pollutionCounts(db!);
    expect(after).toEqual(before);
  }

  function baseEvidence(overrides: Partial<Record<string, string>> = {}) {
    return {
      organizationId: ORG_A,
      projectId: PROJECT_A,
      configRevisionId: orgA.revisionId,
      propertyOccurrenceId: orgA.propertyOccurrenceId,
      logicalNodeId: orgA.logicalNodeId,
      propertyKey: PROPERTY_KEY,
      nodeLocator: orgA.nodeLocator,
      compatible: orgA.compatible,
      ...overrides,
    };
  }

  it("rejects org A task resolving with org B project", async () => {
    const taskId = await insertCrossTenantTask(db!, baseEvidence({ projectId: PROJECT_B }));
    await expectResolveBlocked(taskId);
  });

  it("rejects org A task resolving with org B revision", async () => {
    const taskId = await insertCrossTenantTask(
      db!,
      baseEvidence({ configRevisionId: orgB.revisionId }),
    );
    await expectResolveBlocked(taskId);
  });

  it("rejects org A task resolving with org B property occurrence", async () => {
    const taskId = await insertCrossTenantTask(
      db!,
      baseEvidence({ propertyOccurrenceId: orgB.propertyOccurrenceId }),
    );
    await expectResolveBlocked(taskId);
  });

  it("rejects org A task resolving with org B logical node", async () => {
    const taskId = await insertCrossTenantTask(
      db!,
      baseEvidence({ logicalNodeId: orgB.logicalNodeId }),
    );
    await expectResolveBlocked(taskId);
  });

  it("rejects inconsistent occurrence/revision combo within org A", async () => {
    const secondRevisionId = randomUUID();
    await db!.query(
      `
      insert into dts_config_revisions (
        id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
      ) values ($1, $2, $3, $4, 99, 'resolved', $5)
      `,
      [secondRevisionId, ORG_A, PROJECT_A, CONFIG_SET_A, USER_ID],
    );
    const taskId = await insertCrossTenantTask(
      db!,
      baseEvidence({ configRevisionId: secondRevisionId }),
    );
    await expectResolveBlocked(taskId);
  });

  it("rejects dangling evidence ids without polluting bindings/overrides/decisions/audit", async () => {
    const taskId = await insertCrossTenantTask(
      db!,
      baseEvidence({
        configRevisionId: randomUUID(),
        propertyOccurrenceId: randomUUID(),
        logicalNodeId: randomUUID(),
      }),
    );
    await expectResolveBlocked(taskId);
  });

  it("does not reuse bindings across organizations for the same project/logical-node/spec key", async () => {
    const orgBBindingBefore = await db!.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_bindings where organization_id = $1`,
      [ORG_B],
    );
    expect(Number(orgBBindingBefore.rows[0]?.count)).toBe(0);

    const openTask = await db!.query<{ id: string }>(
      `
      select id from parameter_spec_review_tasks
      where organization_id = $1
        and status = 'open'
        and source_evidence->>'propertyKey' = $2
      limit 1
      `,
      [ORG_A, PROPERTY_KEY],
    );
    await resolveSpecReviewTask(db!, makeAuth(ORG_A), {
      taskId: openTask.rows[0]!.id,
      decision: "resolved",
      parameterSpecId: SPEC_A,
      reason: "valid resolve",
    });

    const orgABindings = await db!.query<{ organization_id: string }>(
      `select organization_id from project_parameter_bindings where parameter_spec_id = $1`,
      [SPEC_A],
    );
    expect(orgABindings.rows.every((row) => row.organization_id === ORG_A)).toBe(true);
    expect(Number(orgBBindingBefore.rows[0]?.count)).toBe(0);
  });
});

describe.skipIf(!databaseAvailable)("0055/0057 review task scope backfill", () => {
  it("only backfills tenant-valid ids, marks invalid evidence with diagnostics, and re-runs idempotently", async () => {
    await withTempDatabase(async (db) => {
      await applyMigrationsThrough(db, "0054_config_revision_manifest_backfill.sql");
      await seedGraph(db);

      const validRevisionId = randomUUID();
      const danglingRevisionId = randomUUID();
      const crossRevisionId = randomUUID();
      await db.query(
        `
        insert into dts_config_revisions (
          id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
        ) values
          ($1, $2, $3, $4, 1, 'resolved', $5),
          ($6, $7, $8, $9, 1, 'resolved', $5)
        `,
        [
          validRevisionId,
          ORG_A,
          PROJECT_A,
          CONFIG_SET_A,
          USER_ID,
          crossRevisionId,
          ORG_B,
          PROJECT_B,
          CONFIG_SET_B,
        ],
      );

      const validOccurrenceId = randomUUID();
      const crossOccurrenceId = randomUUID();
      const nodeOccA = randomUUID();
      const nodeOccB = randomUUID();
      const fileVersionA = randomUUID();
      const fileVersionB = randomUUID();
      const fileIdA = randomUUID();
      const fileIdB = randomUUID();
      await db.query(
        `
        insert into project_parameter_files (id, organization_id, project_id, file_name, format, enabled)
        values ($1, $2, $3, 'a.dts', 'dts', true), ($4, $5, $6, 'b.dts', 'dts', true)
        `,
        [fileIdA, ORG_A, PROJECT_A, fileIdB, ORG_B, PROJECT_B],
      );
      await db.query(
        `
        insert into project_parameter_file_versions (
          id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
        ) values ($1, $2, 1, 'k-a', 'abc', 1, '{}'::jsonb, 'upload', $3),
               ($4, $5, 1, 'k-b', 'def', 1, '{}'::jsonb, 'upload', $3)
        `,
        [fileVersionA, fileIdA, USER_ID, fileVersionB, fileIdB],
      );
      await db.query(
        `
        insert into dts_node_occurrences (
          id, config_revision_id, file_version_id, name, labels, node_path,
          start_offset, end_offset, start_line, start_column, end_line, end_column,
          raw_text, ast_json, source_order
        ) values ($1, $2, $3, 'n', '[]'::jsonb, '/n', 0, 1, 1, 1, 1, 2, 'n', '{}'::jsonb, 0),
               ($4, $5, $6, 'n', '[]'::jsonb, '/n', 0, 1, 1, 1, 1, 2, 'n', '{}'::jsonb, 0)
        `,
        [nodeOccA, validRevisionId, fileVersionA, nodeOccB, crossRevisionId, fileVersionB],
      );
      await db.query(
        `
        insert into dts_property_occurrences (
          id, config_revision_id, node_occurrence_id, file_version_id, property_name,
          start_offset, end_offset, start_line, start_column, end_line, end_column,
          raw_text, ast_json, source_order
        ) values ($1, $2, $3, $4, 'p', 0, 1, 1, 1, 1, 2, '<1>', '{}'::jsonb, 0),
               ($5, $6, $7, $8, 'p', 0, 1, 1, 1, 1, 2, '<1>', '{}'::jsonb, 0)
        `,
        [
          validOccurrenceId,
          validRevisionId,
          nodeOccA,
          fileVersionA,
          crossOccurrenceId,
          crossRevisionId,
          nodeOccB,
          fileVersionB,
        ],
      );

      const validTaskId = randomUUID();
      const crossProjectTaskId = randomUUID();
      const danglingTaskId = randomUUID();
      await db.query(
        `
        insert into parameter_spec_review_tasks (
          id, organization_id, source_evidence, candidate_schemas, project_count, status
        ) values
          ($1, $2, $3::jsonb, '[]'::jsonb, 1, 'open'),
          ($4, $2, $5::jsonb, '[]'::jsonb, 1, 'open'),
          ($6, $2, $7::jsonb, '[]'::jsonb, 1, 'open')
        `,
        [
          validTaskId,
          ORG_A,
          JSON.stringify({
            projectId: PROJECT_A,
            configRevisionId: validRevisionId,
            propertyOccurrenceId: validOccurrenceId,
            propertyKey: PROPERTY_KEY,
          }),
          crossProjectTaskId,
          JSON.stringify({
            projectId: PROJECT_B,
            configRevisionId: validRevisionId,
            propertyOccurrenceId: validOccurrenceId,
            propertyKey: PROPERTY_KEY,
          }),
          danglingTaskId,
          JSON.stringify({
            projectId: PROJECT_A,
            configRevisionId: danglingRevisionId,
            propertyOccurrenceId: randomUUID(),
            propertyKey: PROPERTY_KEY,
          }),
        ],
      );

      await applySingleMigration(db, migration0055);

      const validRow = await db.query<{
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        blocker_scope: string;
      }>(
        `select project_id, config_revision_id, property_occurrence_id, blocker_scope
         from parameter_spec_review_tasks where id = $1`,
        [validTaskId],
      );
      expect(validRow.rows[0]).toMatchObject({
        project_id: PROJECT_A,
        config_revision_id: validRevisionId,
        property_occurrence_id: validOccurrenceId,
        blocker_scope: "revision",
      });

      const crossProjectRow = await db.query<{
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        blocker_scope: string;
        source_evidence: Record<string, unknown>;
      }>(
        `select project_id, config_revision_id, property_occurrence_id, blocker_scope, source_evidence
         from parameter_spec_review_tasks where id = $1`,
        [crossProjectTaskId],
      );
      expect(crossProjectRow.rows[0]?.project_id).toBeNull();
      expect(crossProjectRow.rows[0]?.config_revision_id).toBeNull();
      expect(crossProjectRow.rows[0]?.property_occurrence_id).toBeNull();
      expect(crossProjectRow.rows[0]?.blocker_scope).toBe("platform");
      expect(crossProjectRow.rows[0]?.source_evidence.scopeBackfill).toMatchObject({
        code: "invalid_review_evidence",
      });

      const danglingRow = await db.query<{
        config_revision_id: string | null;
        source_evidence: Record<string, unknown>;
      }>(
        `select config_revision_id, source_evidence from parameter_spec_review_tasks where id = $1`,
        [danglingTaskId],
      );
      expect(danglingRow.rows[0]?.config_revision_id).toBeNull();
      expect(danglingRow.rows[0]?.source_evidence.scopeBackfill).toBeTruthy();

      await applySingleMigration(db, migration0057);
      const rerunRow = await db.query<{ source_evidence: Record<string, unknown> }>(
        `select source_evidence from parameter_spec_review_tasks where id = $1`,
        [crossProjectTaskId],
      );
      expect(rerunRow.rows[0]?.source_evidence.scopeBackfill).toBeTruthy();

      const updated = await backfillReviewTaskScopeColumns(db);
      expect(updated).toBeGreaterThanOrEqual(0);
      const idempotent = await backfillReviewTaskScopeColumns(db);
      expect(idempotent).toBe(0);
    });
  });
});

describe.skipIf(!databaseAvailable)("0058 evidence-only scope reconcile from polluted 0055 state", () => {
  it("clears cross-tenant FKs preserved by 0057 coalesce, keeps valid rows, and rolls back mid-failure", async () => {
    await withTempDatabase(async (db) => {
      await applyMigrationsThrough(db, migration0057);
      await seedGraph(db);

      const validRevisionId = randomUUID();
      const crossRevisionId = randomUUID();
      await db.query(
        `
        insert into dts_config_revisions (
          id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
        ) values
          ($1, $2, $3, $4, 1, 'resolved', $5),
          ($6, $7, $8, $9, 1, 'resolved', $5)
        `,
        [
          validRevisionId,
          ORG_A,
          PROJECT_A,
          CONFIG_SET_A,
          USER_ID,
          crossRevisionId,
          ORG_B,
          PROJECT_B,
          CONFIG_SET_B,
        ],
      );

      const validOccurrenceId = randomUUID();
      const crossOccurrenceId = randomUUID();
      const nodeOccA = randomUUID();
      const nodeOccB = randomUUID();
      const fileVersionA = randomUUID();
      const fileVersionB = randomUUID();
      const fileIdA = randomUUID();
      const fileIdB = randomUUID();
      await db.query(
        `
        insert into project_parameter_files (id, organization_id, project_id, file_name, format, enabled)
        values ($1, $2, $3, 'a.dts', 'dts', true), ($4, $5, $6, 'b.dts', 'dts', true)
        `,
        [fileIdA, ORG_A, PROJECT_A, fileIdB, ORG_B, PROJECT_B],
      );
      await db.query(
        `
        insert into project_parameter_file_versions (
          id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
        ) values ($1, $2, 1, 'k-a', 'abc', 1, '{}'::jsonb, 'upload', $3),
               ($4, $5, 1, 'k-b', 'def', 1, '{}'::jsonb, 'upload', $3)
        `,
        [fileVersionA, fileIdA, USER_ID, fileVersionB, fileIdB],
      );
      await db.query(
        `
        insert into dts_node_occurrences (
          id, config_revision_id, file_version_id, name, labels, node_path,
          start_offset, end_offset, start_line, start_column, end_line, end_column,
          raw_text, ast_json, source_order
        ) values ($1, $2, $3, 'n', '[]'::jsonb, '/n', 0, 1, 1, 1, 1, 2, 'n', '{}'::jsonb, 0),
               ($4, $5, $6, 'n', '[]'::jsonb, '/n', 0, 1, 1, 1, 1, 2, 'n', '{}'::jsonb, 0)
        `,
        [nodeOccA, validRevisionId, fileVersionA, nodeOccB, crossRevisionId, fileVersionB],
      );
      await db.query(
        `
        insert into dts_property_occurrences (
          id, config_revision_id, node_occurrence_id, file_version_id, property_name,
          start_offset, end_offset, start_line, start_column, end_line, end_column,
          raw_text, ast_json, source_order
        ) values ($1, $2, $3, $4, 'p', 0, 1, 1, 1, 1, 2, '<1>', '{}'::jsonb, 0),
               ($5, $6, $7, $8, 'p', 0, 1, 1, 1, 1, 2, '<1>', '{}'::jsonb, 0)
        `,
        [
          validOccurrenceId,
          validRevisionId,
          nodeOccA,
          fileVersionA,
          crossOccurrenceId,
          crossRevisionId,
          nodeOccB,
          fileVersionB,
        ],
      );

      const validTaskId = randomUUID();
      const pollutedTaskId = randomUUID();
      const missingEvidenceTaskId = randomUUID();
      // Simulate historical old-0055 pollution already written into task FKs
      // (0057 coalesce would preserve these incorrect values).
      await db.query(
        `
        insert into parameter_spec_review_tasks (
          id, organization_id, parameter_spec_id, source_evidence, candidate_schemas,
          project_count, status, reviewer_user_id, reason, resolved_at,
          project_id, config_revision_id, property_occurrence_id, blocker_scope
        ) values
          (
            $1, $2, $3, $4::jsonb, '[]'::jsonb, 1, 'resolved', $5, 'ok', now(),
            $6, $7, $8, 'revision'
          ),
          (
            $9, $2, $3, $10::jsonb, '[]'::jsonb, 1, 'resolved', $5, 'polluted', now(),
            $11, $12, $13, 'revision'
          )
        `,
        [
          validTaskId,
          ORG_A,
          SPEC_A,
          JSON.stringify({
            projectId: PROJECT_A,
            configRevisionId: validRevisionId,
            propertyOccurrenceId: validOccurrenceId,
            propertyKey: PROPERTY_KEY,
          }),
          USER_ID,
          PROJECT_A,
          validRevisionId,
          validOccurrenceId,
          pollutedTaskId,
          JSON.stringify({
            // Evidence claims org-A project, but columns were polluted to org-B.
            projectId: PROJECT_A,
            configRevisionId: validRevisionId,
            propertyOccurrenceId: validOccurrenceId,
            propertyKey: PROPERTY_KEY,
          }),
          PROJECT_B,
          crossRevisionId,
          crossOccurrenceId,
        ],
      );

      await db.query(
        `
        insert into parameter_spec_review_tasks (
          id, organization_id, parameter_spec_id, source_evidence, candidate_schemas,
          project_count, status, reviewer_user_id, reason, resolved_at,
          project_id, blocker_scope
        ) values (
          $1, $2, $3, $4::jsonb, '[]'::jsonb, 1, 'resolved', $5,
          'polluted scope without evidence ids', now(), $6, 'revision'
        )
        `,
        [
          missingEvidenceTaskId,
          ORG_A,
          SPEC_A,
          JSON.stringify({ propertyKey: PROPERTY_KEY }),
          USER_ID,
          PROJECT_B,
        ],
      );

      // Prove 0057-style coalesce would keep pollution if re-applied to polluted columns.
      await applySingleMigration(db, migration0057);
      const stillPolluted = await db.query<{
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        status: string;
      }>(
        `select project_id, config_revision_id, property_occurrence_id, status
         from parameter_spec_review_tasks where id = $1`,
        [pollutedTaskId],
      );
      expect(stillPolluted.rows[0]).toMatchObject({
        project_id: PROJECT_B,
        config_revision_id: crossRevisionId,
        property_occurrence_id: crossOccurrenceId,
        status: "resolved",
      });

      // Mid-migration failure must roll back completely.
      await db.query("begin");
      try {
        const sql = await fs.readFile(path.join(migrationsDir, migration0058), "utf8");
        await db.query(sql);
        await db.query("select 1 / 0");
        await db.query("commit");
      } catch {
        await db.query("rollback");
      }
      const afterRollback = await db.query<{ project_id: string | null; status: string }>(
        `select project_id, status from parameter_spec_review_tasks where id = $1`,
        [pollutedTaskId],
      );
      expect(afterRollback.rows[0]).toMatchObject({
        project_id: PROJECT_B,
        status: "resolved",
      });

      await applySingleMigration(db, migration0058);

      const rebuilt = await db.query<{
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        status: string;
        parameter_spec_id: string | null;
        blocker_scope: string;
        source_evidence: Record<string, unknown>;
      }>(
        `select project_id, config_revision_id, property_occurrence_id, status,
                parameter_spec_id, blocker_scope, source_evidence
         from parameter_spec_review_tasks where id = $1`,
        [pollutedTaskId],
      );
      // Evidence proves PROJECT_A chain — polluted columns rebuilt from evidence only.
      expect(rebuilt.rows[0]).toMatchObject({
        project_id: PROJECT_A,
        config_revision_id: validRevisionId,
        property_occurrence_id: validOccurrenceId,
        status: "resolved",
        parameter_spec_id: SPEC_A,
        blocker_scope: "revision",
      });
      expect(rebuilt.rows[0]?.source_evidence.scopeBackfill).toMatchObject({
        migration: "0058",
        clearedPriorProjectId: PROJECT_B,
        provenProjectId: PROJECT_A,
      });

      const kept = await db.query<{
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        status: string;
        parameter_spec_id: string | null;
      }>(
        `select project_id, config_revision_id, property_occurrence_id, status, parameter_spec_id
         from parameter_spec_review_tasks where id = $1`,
        [validTaskId],
      );
      expect(kept.rows[0]).toMatchObject({
        project_id: PROJECT_A,
        config_revision_id: validRevisionId,
        property_occurrence_id: validOccurrenceId,
        status: "resolved",
        parameter_spec_id: SPEC_A,
      });

      // Unproven / cross-tenant evidence: clear FKs and reopen so finalize cannot treat as resolved.
      const unprovenTaskId = randomUUID();
      await db.query(
        `
        insert into parameter_spec_review_tasks (
          id, organization_id, parameter_spec_id, source_evidence, candidate_schemas,
          project_count, status, reviewer_user_id, resolved_at,
          project_id, config_revision_id, property_occurrence_id, blocker_scope
        ) values (
          $1, $2, $3, $4::jsonb, '[]'::jsonb, 1, 'resolved', $5, now(),
          $6, $7, $8, 'revision'
        )
        `,
        [
          unprovenTaskId,
          ORG_A,
          SPEC_A,
          JSON.stringify({
            projectId: PROJECT_B,
            configRevisionId: crossRevisionId,
            propertyOccurrenceId: crossOccurrenceId,
            propertyKey: PROPERTY_KEY,
          }),
          USER_ID,
          PROJECT_B,
          crossRevisionId,
          crossOccurrenceId,
        ],
      );
      await applySingleMigration(db, migration0058);
      const unproven = await db.query<{
        project_id: string | null;
        status: string;
        parameter_spec_id: string | null;
        blocker_scope: string;
        source_evidence: Record<string, unknown>;
      }>(
        `select project_id, status, parameter_spec_id, blocker_scope, source_evidence
         from parameter_spec_review_tasks where id = $1`,
        [unprovenTaskId],
      );
      expect(unproven.rows[0]?.project_id).toBeNull();
      expect(unproven.rows[0]?.status).toBe("open");
      expect(unproven.rows[0]?.parameter_spec_id).toBeNull();
      expect(unproven.rows[0]?.blocker_scope).toBe("platform");
      expect(unproven.rows[0]?.source_evidence.scopeBackfill).toMatchObject({
        migration: "0058",
        code: "polluted_or_unproven_scope",
      });

      const missingEvidence = await db.query<{
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        status: string;
        parameter_spec_id: string | null;
        reviewer_user_id: string | null;
        resolved_at: Date | null;
        blocker_scope: string;
        source_evidence: Record<string, unknown>;
      }>(
        `select project_id, config_revision_id, property_occurrence_id, status,
                parameter_spec_id, reviewer_user_id, resolved_at, blocker_scope, source_evidence
         from parameter_spec_review_tasks where id = $1`,
        [missingEvidenceTaskId],
      );
      expect(missingEvidence.rows[0]).toMatchObject({
        project_id: null,
        config_revision_id: null,
        property_occurrence_id: null,
        status: "open",
        parameter_spec_id: null,
        reviewer_user_id: null,
        resolved_at: null,
        blocker_scope: "platform",
      });
      expect(missingEvidence.rows[0]?.source_evidence.scopeBackfill).toMatchObject({
        migration: "0058",
        code: "missing_or_unproven_evidence_chain",
        clearedPriorProjectId: PROJECT_B,
      });

      // Idempotent second apply: no scoped value or diagnostic metadata changes.
      const beforeSecondApply = await db.query<{
        id: string;
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        status: string;
        source_evidence: Record<string, unknown>;
      }>(
        `select id, project_id, config_revision_id, property_occurrence_id, status, source_evidence
         from parameter_spec_review_tasks where id = any($1::text[]) order by id`,
        [[pollutedTaskId, missingEvidenceTaskId]],
      );
      await applySingleMigration(db, migration0058);
      const again = await db.query<{
        id: string;
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        status: string;
        source_evidence: Record<string, unknown>;
      }>(
        `select id, project_id, config_revision_id, property_occurrence_id, status, source_evidence
         from parameter_spec_review_tasks where id = any($1::text[]) order by id`,
        [[pollutedTaskId, missingEvidenceTaskId]],
      );
      expect(again.rows).toEqual(beforeSecondApply.rows);
    });
  });
});
