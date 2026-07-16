import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { ingestConfigRevision } from "./ingestService";
import type { ConfigRevisionManifest } from "./types";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const seedDir = join(root, "src/config/dts-seed");
const overlaySource = readFileSync(join(seedDir, "base-power-overlay.dts"), "utf8");
const baseSource = readFileSync(join(seedDir, "wiseeff-power-base.dts"), "utf8");

const ORG_ID = "org-topo-ingest";
const PROJECT_ID = "project-topo-ingest";
const USER_ID = "user-topo-ingest";
const CONFIG_SET_ID = "dcs-topo-ingest";
const SC8562_LOCATOR = "/amba/i2c@FDF5E000/sc8562@6E";
const MT5788_LOCATOR = "/amba/i2c@FF24E000/mt5788@2B";

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(): AuthContext {
  return {
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      name: "Topo Ingest Admin",
      email: "topo-ingest@example.com",
      title: "Admin",
      isActive: true,
    },
    organization: { id: ORG_ID, name: "Topo Ingest Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  };
}

/** Label stubs only — keeps the manifest complete without adding base property rows. */
function buildLabelStubBase(source: string): string {
  const labels = [...source.matchAll(/^&([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm)].map((match) => match[1]);
  const unique = [...new Set(labels)];
  return `/dts-v1/;\n/ {\n${unique.map((label) => `\t${label}: ${label} {};\n`).join("")}};\n`;
}

async function seedGraph(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'Topo Ingest Org')
     on conflict (id) do update set name = excluded.name`,
    [ORG_ID],
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, $2, 'Topo Ingest Admin', 'topo-ingest@example.com', 'Admin', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
    [USER_ID, ORG_ID],
  );
  await db.query(
    `
    insert into projects (id, organization_id, name, code, status)
    values ($1, $2, 'Topo Ingest', 'TPI', 'initialized')
    on conflict (id) do update set name = excluded.name
    `,
    [PROJECT_ID, ORG_ID],
  );
  await db.query(
    `
    insert into dts_config_set (id, organization_id, project_id, name, description)
    values ($1, $2, $3, 'golden-power', 'Task 5 ingest fixture')
    on conflict (id) do update set name = excluded.name
    `,
    [CONFIG_SET_ID, ORG_ID, PROJECT_ID],
  );
}

async function insertPinnedMember(
  db: InMemoryTestDatabase,
  input: {
    fileId: string;
    fileName: string;
    versionId: string;
    content: string;
    role: "base" | "overlay";
    sortOrder: number;
  },
) {
  const checksum = createHash("sha256").update(input.content, "utf8").digest("hex");
  await db.query(
    `
    insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled,
      config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, $4, 'dts', true, $5, $6, $7)
    `,
    [input.fileId, ORG_ID, PROJECT_ID, input.fileName, CONFIG_SET_ID, input.role, input.sortOrder],
  );
  await db.query(
    `
    insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload', $6)
    `,
    [
      input.versionId,
      input.fileId,
      `${ORG_ID}/${checksum}-${input.fileName}`,
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

function goldenManifest(options?: { useRealBase?: boolean }): ConfigRevisionManifest {
  const baseFileId = "file-base-topo";
  const overlayFileId = "file-overlay-topo";
  const baseVersionId = "fv-base-topo";
  const overlayVersionId = "fv-overlay-topo";
  const baseContent = options?.useRealBase ? baseSource : buildLabelStubBase(overlaySource);
  return {
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    configSetId: CONFIG_SET_ID,
    entryFile: "wiseeff-power-base.dts",
    includeSearchPaths: ["."],
    overlayOrder: ["base-power-overlay.dts"],
    members: [
      {
        fileId: baseFileId,
        fileVersionId: baseVersionId,
        fileName: "wiseeff-power-base.dts",
        role: "base",
        sortOrder: 0,
        content: baseContent,
      },
      {
        fileId: overlayFileId,
        fileVersionId: overlayVersionId,
        fileName: "base-power-overlay.dts",
        role: "overlay",
        sortOrder: 1,
        content: overlaySource,
      },
    ],
  };
}

async function bindingForNodeProperty(
  db: InMemoryTestDatabase,
  configRevisionId: string,
  nodeLocator: string,
  propertyKey: string,
) {
  const result = await db.query<{
    binding_id: string;
    logical_node_id: string;
    parameter_spec_id: string;
  }>(
    `
    select b.id as binding_id, b.logical_node_id, b.parameter_spec_id
    from project_parameter_bindings b
    inner join project_parameter_binding_revisions br
      on br.binding_id = b.id and br.config_revision_id = $1
    inner join dts_logical_node_revisions lnr
      on lnr.logical_node_id = b.logical_node_id and lnr.config_revision_id = $1
    inner join parameter_specs ps on ps.id = b.parameter_spec_id
    left join dts_property_specs dps on dps.parameter_spec_id = b.parameter_spec_id
    where lnr.node_locator = $2
      and coalesce(dps.property_key, nullif(split_part(ps.specification_key, '/', 2), ''), '') = $3
    limit 1
    `,
    [configRevisionId, nodeLocator, propertyKey],
  );
  const row = result.rows[0];
  return row
    ? {
        bindingId: row.binding_id,
        logicalNodeId: row.logical_node_id,
        parameterSpecId: row.parameter_spec_id,
      }
    : null;
}

async function countTable(
  db: InMemoryTestDatabase,
  table: string,
  configRevisionId: string,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `select count(*)::text as count from ${table} where config_revision_id = $1`,
    [configRevisionId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function effectiveProperty(
  db: InMemoryTestDatabase,
  configRevisionId: string,
  nodeLocator: string,
  propertyName: string,
) {
  const result = await db.query<{ property_name: string; raw_text: string }>(
    `
    select po.property_name, po.raw_text
    from dts_occurrence_effects oe
    inner join dts_logical_node_revisions lnr on lnr.id = oe.logical_node_revision_id
    inner join dts_property_occurrences po on po.id = oe.property_occurrence_id
    where oe.config_revision_id = $1
      and lnr.node_locator = $2
      and oe.property_name = $3
      and oe.effect_kind in ('set', 'override')
    order by oe.source_order desc
    limit 1
    `,
    [configRevisionId, nodeLocator, propertyName],
  );
  const row = result.rows[0];
  return row ? { propertyName: row.property_name, rawText: row.raw_text } : null;
}

describe.skipIf(!databaseAvailable)("ingestConfigRevision", () => {
  let db: InMemoryTestDatabase | undefined;
  let auth: AuthContext;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedGraph(db);
    auth = makeAuth();
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it(
    "persists 170 golden property occurrences and effective gpio_int in one revision",
    async () => {
      const manifest = goldenManifest();
      for (const member of manifest.members) {
        await insertPinnedMember(db!, {
          fileId: member.fileId,
          fileName: member.fileName,
          versionId: member.fileVersionId,
          content: member.content,
          role: member.role === "base" ? "base" : "overlay",
          sortOrder: member.sortOrder,
        });
      }

      const revision = await ingestConfigRevision(db!, manifest, auth);

      expect(revision.status).toBe("resolved");
      expect(await countTable(db!, "dts_property_occurrences", revision.id)).toBe(170);
      expect(
        await effectiveProperty(db!, revision.id, "/amba/i2c@FDF5E000/sc8562@6E", "gpio_int"),
      ).toMatchObject({ propertyName: "gpio_int", rawText: "<&gpio13 29 0>" });

      const lineCol = await db!.query<{ start_line: number; start_column: number }>(
        `
        select start_line, start_column
        from dts_property_occurrences
        where config_revision_id = $1 and property_name = 'gpio_int' and raw_text = '<&gpio13 29 0>'
        limit 1
        `,
        [revision.id],
      );
      expect(lineCol.rows[0]?.start_line).toBeGreaterThan(0);
      expect(lineCol.rows[0]?.start_column).toBeGreaterThan(0);
    },
    60_000
  );

  it("leaves no partial occurrence rows when an include fails", async () => {
    const baseFileId = randomUUID();
    const baseVersionId = randomUUID();
    const broken = `/dts-v1/;\n/include/ "missing-pins.dtsi";\n/ { board_id = <1>; };\n`;
    await insertPinnedMember(db!, {
      fileId: baseFileId,
      fileName: "board.dts",
      versionId: baseVersionId,
      content: broken,
      role: "base",
      sortOrder: 0,
    });

    const revision = await ingestConfigRevision(
      db!,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        configSetId: CONFIG_SET_ID,
        entryFile: "board.dts",
        includeSearchPaths: ["."],
        overlayOrder: [],
        members: [
          {
            fileId: baseFileId,
            fileVersionId: baseVersionId,
            fileName: "board.dts",
            role: "base",
            sortOrder: 0,
            content: broken,
          },
        ],
      },
      auth,
    );

    expect(revision.status).toBe("invalid");
    expect(await countTable(db!, "dts_property_occurrences", revision.id)).toBe(0);
    expect(await countTable(db!, "dts_node_occurrences", revision.id)).toBe(0);
    expect(await countTable(db!, "dts_occurrence_effects", revision.id)).toBe(0);

    const diagnostics = await db!.query<{ code: string }>(
      `
      select d.code
      from dts_validation_diagnostics d
      inner join dts_validation_runs r on r.id = d.validation_run_id
      where r.config_revision_id = $1
      `,
      [revision.id],
    );
    expect(diagnostics.rows.map((row) => row.code)).toContain("include-missing");
  });

  it(
    "never mutates a previous revision when ingesting again",
    async () => {
      const manifest = goldenManifest();
      for (const member of manifest.members) {
        await insertPinnedMember(db!, {
          fileId: member.fileId,
          fileName: member.fileName,
          versionId: member.fileVersionId,
          content: member.content,
          role: member.role === "base" ? "base" : "overlay",
          sortOrder: member.sortOrder,
        });
      }

      const first = await ingestConfigRevision(db!, manifest, auth);
      const second = await ingestConfigRevision(db!, manifest, auth);

      expect(first.id).not.toBe(second.id);
      expect(second.revisionNumber).toBe(first.revisionNumber + 1);

      const firstStatus = await db!.query<{ status: string }>(
        `select status from dts_config_revisions where id = $1`,
        [first.id],
      );
      expect(firstStatus.rows[0]?.status).toBe("resolved");
      expect(await countTable(db!, "dts_property_occurrences", first.id)).toBe(170);
      expect(await countTable(db!, "dts_property_occurrences", second.id)).toBe(170);
    },
    60_000
  );

  it(
    "reuses stable bindingId for sc8562@6E.gpio_int across consecutive full-config-set revisons",
    async () => {
      const manifest = goldenManifest({ useRealBase: true });
      for (const member of manifest.members) {
        await insertPinnedMember(db!, {
          fileId: member.fileId,
          fileName: member.fileName,
          versionId: member.fileVersionId,
          content: member.content,
          role: member.role === "base" ? "base" : "overlay",
          sortOrder: member.sortOrder,
        });
      }

      const first = await ingestConfigRevision(db!, manifest, auth);
      const second = await ingestConfigRevision(db!, manifest, auth);

      expect(first.status).toBe("resolved");
      expect(second.status).toBe("resolved");
      expect(second.revisionNumber).toBe(first.revisionNumber + 1);

      const firstGpio = await bindingForNodeProperty(db!, first.id, SC8562_LOCATOR, "gpio_int");
      const secondGpio = await bindingForNodeProperty(db!, second.id, SC8562_LOCATOR, "gpio_int");
      expect(firstGpio).toBeTruthy();
      expect(secondGpio).toBeTruthy();
      expect(secondGpio!.bindingId).toBe(firstGpio!.bindingId);
      expect(secondGpio!.logicalNodeId).toBe(firstGpio!.logicalNodeId);

      const mt5788First = await bindingForNodeProperty(db!, first.id, MT5788_LOCATOR, "gpio_int");
      expect(mt5788First).toBeTruthy();
      expect(mt5788First!.parameterSpecId).not.toBe(firstGpio!.parameterSpecId);
      expect(mt5788First!.parameterSpecId).toMatch(/mt5788/i);
      expect(firstGpio!.parameterSpecId).toMatch(/sc8562/i);
    },
    60_000
  );
});
