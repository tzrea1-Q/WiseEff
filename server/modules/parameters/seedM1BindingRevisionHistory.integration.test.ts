import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import type { ObjectStore } from "../logs/objectStore";
import type { DtsPowerSeedProjectFile } from "../../../scripts/dts-power-seed";
import {
  BINDING_REVISION_HISTORY_DEMO,
  seedM1BindingRevisionHistory,
  seedM1DtsFiles,
  seedM1SemanticTopology
} from "../../../scripts/seed-m1-parameters";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const seedDir = join(root, "src/config/dts-seed");
const primarySource = readFileSync(join(seedDir, "aurora-board.dts"), "utf8");

const ORG_ID = "org-chargelab";
const USER_ID = "u-xu-yun";
const PROJECT_ID = "aurora";

const databaseAvailable = await isTestDatabaseAvailable();

function createInMemoryObjectStore(): ObjectStore {
  const objects = new Map<string, Buffer>();
  return {
    async put(input) {
      const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
      const storageKey = `${input.organizationId}/${checksumSha256}-${input.fileName}`;
      objects.set(storageKey, Buffer.from(input.bytes));
      return {
        storageKey,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSizeBytes: input.bytes.length,
        checksumSha256
      };
    },
    async get(storageKey) {
      const bytes = objects.get(storageKey);
      if (!bytes) throw new Error(`missing object: ${storageKey}`);
      return bytes;
    }
  };
}

async function resetProjectTopology(db: InMemoryTestDatabase) {
  await db.query(`delete from parameter_spec_matcher_overrides where project_id = $1`, [PROJECT_ID]);
  await db.query(
    `delete from parameter_drafts
     where project_parameter_binding_id in (
       select id from project_parameter_bindings where project_id = $1
     )
     or candidate_config_revision_id in (
       select id from dts_config_revisions where project_id = $1
     )`,
    [PROJECT_ID]
  );
  await db.query(`delete from dts_config_revisions where project_id = $1`, [PROJECT_ID]);

  const bindingRefTables = [
    "parameter_history_entries:project_parameter_binding_id",
    "parameter_drafts:project_parameter_binding_id",
    "parameter_change_requests:project_parameter_binding_id",
    "parameter_submission_items:project_parameter_binding_id",
    "parameter_file_sync_conflicts:project_parameter_binding_id",
    "debugging_parameters:project_parameter_binding_id",
    "node_operations:project_parameter_binding_id"
  ];
  for (const entry of bindingRefTables) {
    const [table, column] = entry.split(":");
    await db.query(
      `update ${table} set ${column} = null
       where ${column} in (select id from project_parameter_bindings where project_id = $1)`,
      [PROJECT_ID]
    );
  }
  await db.query(`delete from project_parameter_bindings where project_id = $1`, [PROJECT_ID]);
  await db.query(`delete from project_parameter_files where project_id = $1`, [PROJECT_ID]);
  await db.query(`delete from dts_config_set where project_id = $1`, [PROJECT_ID]);
}

async function seedMinimalGraph(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'ChargeLab')
     on conflict (id) do update set name = excluded.name`,
    [ORG_ID]
  );
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'Xu Yun', 'xu@chargelab.cn', 'Platform Owner', true)
     on conflict (id) do update set organization_id = excluded.organization_id`,
    [USER_ID, ORG_ID]
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'Aurora', 'AUR', 'initialized')
     on conflict (id) do update set organization_id = excluded.organization_id`,
    [PROJECT_ID, ORG_ID]
  );
}

describe.skipIf(!databaseAvailable)("seedM1BindingRevisionHistory", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedMinimalGraph(db);
    await resetProjectTopology(db);
  }, 60_000);

  afterEach(async () => {
    await db?.rollback();
  });

  it("produces a second config revision so at least one binding has >=2 revisions with distinct raw values", async () => {
    const objectStore = createInMemoryObjectStore();
    const projectFile: DtsPowerSeedProjectFile = {
      projectId: PROJECT_ID,
      fileName: "aurora-board.dts",
      artifactFileName: "aurora-board.dts",
      source: primarySource
    };

    await seedM1DtsFiles(db!, objectStore, [projectFile]);
    await seedM1SemanticTopology(db!, [projectFile]);
    await seedM1BindingRevisionHistory(db!, objectStore, [projectFile]);

    const revisions = await db!.query<{ count: string }>(
      `select count(*)::text as count from dts_config_revisions where project_id = $1`,
      [PROJECT_ID]
    );
    expect(Number(revisions.rows[0]?.count ?? "0")).toBe(2);

    const multiRevisionBindings = await db!.query<{ count: string }>(
      `
      select count(*)::text as count from (
        select br.binding_id
        from project_parameter_binding_revisions br
        inner join project_parameter_bindings b on b.id = br.binding_id
        where b.project_id = $1
        group by br.binding_id
        having count(*) >= 2
      ) t
      `,
      [PROJECT_ID]
    );
    expect(Number(multiRevisionBindings.rows[0]?.count ?? "0")).toBeGreaterThan(0);

    const changedRawValues = await db!.query<{ raw_value: string | null }>(
      `
      select br.raw_value
      from project_parameter_binding_revisions br
      inner join project_parameter_bindings b on b.id = br.binding_id
      inner join parameter_specs ps on ps.id = b.parameter_spec_id
      inner join dts_config_revisions cr on cr.id = br.config_revision_id
      where b.project_id = $1
        and ps.specification_key like '%watchdog_time%'
      order by cr.revision_number asc
      `,
      [PROJECT_ID]
    );
    const rawValues = changedRawValues.rows.map((row) => row.raw_value);
    expect(rawValues.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rawValues).size).toBeGreaterThan(1);
    expect(BINDING_REVISION_HISTORY_DEMO.replace).toContain("6000");

    const revisedVersion = await db!.query<{ storage_key: string; idxlen: string }>(
      `
      select v.storage_key, length(v.parsed_index::text)::text as idxlen
      from project_parameter_file_versions v
      inner join project_parameter_files f on f.id = v.file_id
      where f.project_id = $1
      order by v.version_number desc
      limit 1
      `,
      [PROJECT_ID]
    );
    expect(Number(revisedVersion.rows[0]?.idxlen ?? "0")).toBeGreaterThan(2);
    const storedBytes = await objectStore.get(revisedVersion.rows[0]!.storage_key);
    expect(storedBytes.toString("utf8")).toContain("watchdog_time = <6000>;");
  });

  it("is idempotent: rerunning the history seed does not add a third config revision", async () => {
    const objectStore = createInMemoryObjectStore();
    const projectFile: DtsPowerSeedProjectFile = {
      projectId: PROJECT_ID,
      fileName: "aurora-board.dts",
      artifactFileName: "aurora-board.dts",
      source: primarySource
    };

    await seedM1DtsFiles(db!, objectStore, [projectFile]);
    await seedM1SemanticTopology(db!, [projectFile]);
    await seedM1BindingRevisionHistory(db!, objectStore, [projectFile]);
    await seedM1BindingRevisionHistory(db!, objectStore, [projectFile]);

    const revisions = await db!.query<{ count: string }>(
      `select count(*)::text as count from dts_config_revisions where project_id = $1`,
      [PROJECT_ID]
    );
    expect(Number(revisions.rows[0]?.count ?? "0")).toBe(2);
  });
});
