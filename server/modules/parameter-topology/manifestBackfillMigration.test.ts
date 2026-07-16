import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../shared/database/client";
import { applyMigrations, getPendingMigrations } from "../../shared/database/migrations";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationsDir = path.join(projectRoot, "server", "migrations");
const migration0054 = "0054_config_revision_manifest_backfill.sql";

const ORG = "org-mig-0054";
const PROJECT = "project-mig-0054";
const USER = "user-mig-0054";
const CONFIG_SET = "dcs-mig-0054";

const databaseAvailable = await isTestDatabaseAvailable();

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

function checksum(content: string) {
  return createHash("sha256").update(content).digest("hex");
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
  const dbName = `wiseeff_mig0054_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`.replace(
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

async function applyMigrationsThrough(db: Database, maxExclusive: string): Promise<string[]> {
  await db.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const limited = files.filter((file) => file < maxExclusive);
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

type RevisionRow = {
  id: string;
  entry_file: string | null;
  include_search_paths: unknown;
  overlay_order: unknown;
  manifest_state: string;
};

async function seedPre0054HistoricalRevisions(db: Database) {
  await db.query(`insert into organizations (id, name) values ($1, 'Mig 0054 Org')`, [ORG]);
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'Mig User', 'mig0054@example.com', 'Admin', true)`,
    [USER, ORG],
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'Mig Project', 'MIG0054', 'active')`,
    [PROJECT, ORG],
  );
  await db.query(
    `insert into dts_config_set (id, organization_id, project_id, name, description)
     values ($1, $2, $3, 'default', 'Mig 0054 fixture')`,
    [CONFIG_SET, ORG, PROJECT],
  );

  const baseContent = `/dts-v1/;\n/ { compatible = "wiseeff,mig0054"; };\n`;
  const overlayA = `/dts-v1/;\n/plugin/;\n&{/ { status = "okay"; };`;
  const overlayB = `/dts-v1/;\n/plugin/;\n&{/ { bootargs = "test"; };`;

  async function insertFile(
    fileId: string,
    fileName: string,
    content: string,
    ppfRole: string | null,
    ppfSort: number,
  ) {
    const versionId = `ppv-${fileId}`;
    const fileChecksum = checksum(content);
    await db.query(
      `insert into project_parameter_files (
        id, organization_id, project_id, file_name, format, enabled, config_set_id,
        config_set_role, config_set_sort_order
      ) values ($1, $2, $3, $4, 'dts', true, $5, $6, $7)`,
      [fileId, ORG, PROJECT, fileName, CONFIG_SET, ppfRole, ppfSort],
    );
    await db.query(
      `insert into project_parameter_file_versions (
        id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
      ) values ($1, $2, 1, $3, $4, $5, $6::jsonb, 'upload', $7)`,
      [
        versionId,
        fileId,
        `${ORG}/${fileChecksum}-${fileName}`,
        fileChecksum,
        Buffer.byteLength(content),
        JSON.stringify({ sourceText: content }),
        USER,
      ],
    );
    await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
      versionId,
      fileId,
    ]);
    return { fileId, versionId, fileName };
  }

  const base = await insertFile("file-base", "hist-base.dts", baseContent, "overlay", 99);
  const ovA = await insertFile("file-ov-a", "hist-ov-a.dts", overlayA, "base", 0);
  const ovB = await insertFile("file-ov-b", "hist-ov-b.dts", overlayB, "base", 0);
  const base2 = await insertFile("file-base-2", "hist-base-2.dts", baseContent, "base", 0);

  async function insertRevision(
    revisionId: string,
    revisionNumber: number,
    members: Array<{ id: string; file: typeof base; role: string; sortOrder: number }>,
    manifest?: {
      entryFile?: string;
      includeSearchPaths?: string[];
      overlayOrder?: string[];
    },
  ) {
    await db.query(
      `insert into dts_config_revisions (
        id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id,
        entry_file, include_search_paths, overlay_order
      ) values ($1, $2, $3, $4, $5, 'compiled', $6, $7, $8::jsonb, $9::jsonb)`,
      [
        revisionId,
        ORG,
        PROJECT,
        CONFIG_SET,
        revisionNumber,
        USER,
        manifest?.entryFile ?? null,
        JSON.stringify(manifest?.includeSearchPaths ?? []),
        JSON.stringify(manifest?.overlayOrder ?? []),
      ],
    );
    for (const member of members) {
      await db.query(
        `insert into dts_config_revision_members (
          id, config_revision_id, file_id, file_version_id, role, sort_order
        ) values ($1, $2, $3, $4, $5, $6)`,
        [
          member.id,
          revisionId,
          member.file.fileId,
          member.file.versionId,
          member.role,
          member.sortOrder,
        ],
      );
    }
  }

  // Complete: pinned members disagree with live ppf roles; includes evidence present.
  await insertRevision(
    "cr-complete",
    1,
    [
      { id: "m-complete-base", file: base, role: "base", sortOrder: 0 },
      { id: "m-complete-ov", file: ovA, role: "overlay", sortOrder: 1 },
    ],
    { includeSearchPaths: ["."] },
  );

  // needs_review: multi-base members.
  await insertRevision(
    "cr-multi-base",
    2,
    [
      { id: "m-mb-1", file: base, role: "base", sortOrder: 0 },
      { id: "m-mb-2", file: base2, role: "base", sortOrder: 1 },
    ],
    { includeSearchPaths: ["."] },
  );

  // needs_review: includeSearchPaths without evidence (empty default).
  await insertRevision("cr-no-includes", 3, [
    { id: "m-ni-base", file: base2, role: "base", sortOrder: 0 },
  ]);

  // needs_review: overlay order uncertain (same sort_order).
  await insertRevision("cr-overlay-tie", 4, [
    { id: "m-ot-base", file: base2, role: "base", sortOrder: 0 },
    { id: "m-ot-a", file: ovA, role: "overlay", sortOrder: 1 },
    { id: "m-ot-b", file: ovB, role: "overlay", sortOrder: 1 },
  ]);

  // needs_review: no members.
  await db.query(
    `insert into dts_config_revisions (
      id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
    ) values ('cr-empty', $1, $2, $3, 5, 'compiled', $4)`,
    [ORG, PROJECT, CONFIG_SET, USER],
  );
}

describe.skipIf(!databaseAvailable)("0054 config revision manifest backfill", () => {
  it("backfills from pinned members and marks uncertain manifests needs_review", async () => {
    await withTempDatabase(async (db) => {
      const through0053 = await applyMigrationsThrough(db, migration0054);
      expect(through0053.at(-1)).toBe("0053_topology_round3_scoping_writeback.sql");

      await seedPre0054HistoricalRevisions(db);

      const pending = await applyMigrations(db, migrationsDir);
      expect(pending[0]).toBe(migration0054);

      const rows = await db.query<RevisionRow>(
        `select id, entry_file, include_search_paths, overlay_order, manifest_state
         from dts_config_revisions
         where id like 'cr-%'
         order by id`,
      );

      const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row]));

      expect(byId["cr-complete"]).toMatchObject({
        entry_file: "hist-base.dts",
        manifest_state: "complete",
        include_search_paths: ["."],
      });
      expect(byId["cr-complete"]?.overlay_order).toEqual(["hist-ov-a.dts"]);

      expect(byId["cr-multi-base"]).toMatchObject({
        manifest_state: "needs_review",
      });

      expect(byId["cr-no-includes"]).toMatchObject({
        entry_file: "hist-base-2.dts",
        manifest_state: "needs_review",
        include_search_paths: [],
      });

      expect(byId["cr-overlay-tie"]).toMatchObject({
        manifest_state: "needs_review",
      });
      expect(byId["cr-overlay-tie"]?.overlay_order).toEqual(["hist-ov-a.dts", "hist-ov-b.dts"]);

      expect(byId["cr-empty"]).toMatchObject({
        manifest_state: "needs_review",
      });

      const index = await db.query<{ indexname: string }>(
        `select indexname from pg_indexes
         where tablename = 'dts_config_revisions'
           and indexname = 'dts_config_revisions_manifest_state_idx'`,
      );
      expect(index.rows.length).toBe(1);
    });
  });
});
