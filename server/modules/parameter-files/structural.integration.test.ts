import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { buildDtsParsedIndex } from "./parseIndex";
import { parseDts, serializeDts } from "../dts";
import { uploadProjectParameterFile } from "./service";
import { syncFileVersion } from "./syncService";
import { patchDtsProperty } from "./writebackService";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "dts-teaching-sample.dts");
const teachingSample = readFileSync(fixturePath, "utf8");
/** Teaching fixture without /include/ so upload is allowed. */
const uploadableSample = teachingSample.replace(/\n\/include\/[^\n]*/g, "\n");

function makeAuth(): AuthContext {
  return {
    user: {
      id: "user-struct-int",
      organizationId: "org-struct-int",
      name: "Struct Admin",
      email: "struct-int@example.com",
      title: "Admin",
      isActive: true,
    },
    organization: { id: "org-struct-int", name: "Struct Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  };
}

function createMemoryObjectStore(): ObjectStore {
  const entries = new Map<string, Buffer>();
  return {
    async put(input) {
      const checksum = createHash("sha256").update(input.bytes).digest("hex");
      const storageKey = `${input.organizationId}/${checksum}-${input.fileName}`;
      entries.set(storageKey, Buffer.from(input.bytes));
      return {
        storageKey,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSizeBytes: input.bytes.byteLength,
        checksumSha256: checksum,
      };
    },
    async get(storageKey) {
      const value = entries.get(storageKey);
      if (!value) throw new Error(`Missing object: ${storageKey}`);
      return Buffer.from(value);
    },
  };
}

async function seedBaseline(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ('org-struct-int', 'Struct Org')
     on conflict (id) do update set name = excluded.name`,
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ('user-struct-int', 'org-struct-int', 'Struct Admin', 'struct-int@example.com', 'Admin', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
  );
  await db.query(
    `
    insert into projects (id, organization_id, name, code, status)
    values ('project-struct-int', 'org-struct-int', 'Struct', 'STR', 'initialized')
    on conflict (id) do update set name = excluded.name
    `,
  );
  for (const [id, name, module] of [
    ["pd-bc0", "status", "demo_multi_instance/battery_checker@0"],
    ["pd-bc1", "status", "demo_multi_instance/battery_checker@1"],
    ["pd-spare0", "spare-cycles", "demo_multi_instance/battery_checker@0"],
    ["pd-hex", "mixed_case_reg", "amba/i2c@XXXX0000"],
  ] as const) {
    await db.query(
      `
      insert into parameter_definitions (
        id, organization_id, name, description, explanation, config_format,
        module, default_range, unit, risk
      ) values (
        $1, 'org-struct-int', $2, $2, $2, 'DTS', $3, '', '', 'Low'
      ) on conflict (id) do update set name = excluded.name, module = excluded.module
      `,
      [id, name, module],
    );
  }
  await db.query(
    `
    insert into project_parameter_values (
      id, organization_id, project_id, parameter_definition_id,
      current_value, recommended_value, value_version, updated_by_user_id,
      source_file_name, source_node_path
    ) values
      ('ppv-bc0', 'org-struct-int', 'project-struct-int', 'pd-bc0',
       '"ok"', '"ok"', 1, 'user-struct-int',
       null, 'demo_multi_instance/battery_checker@0/status'),
      ('ppv-bc1', 'org-struct-int', 'project-struct-int', 'pd-bc1',
       '"disabled"', '"disabled"', 1, 'user-struct-int',
       null, 'demo_multi_instance/battery_checker@1/status'),
      ('ppv-spare0', 'org-struct-int', 'project-struct-int', 'pd-spare0',
       '<150>', '<150>', 1, 'user-struct-int',
       null, 'demo_multi_instance/battery_checker@0/spare-cycles'),
      ('ppv-hex', 'org-struct-int', 'project-struct-int', 'pd-hex',
       '/bits/ 8 <0xab 0xcd 0xef 0x12>', '/bits/ 8 <0xab 0xcd 0xef 0x12>', 1, 'user-struct-int',
       null, 'amba/i2c@XXXX0000/mixed_case_reg')
    on conflict (id) do update set current_value = excluded.current_value
    `,
  );
}

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("DTS structural integration", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedBaseline(db);
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("upload → structural ingest → sync distinguishes @0/@1 instances", async () => {
    const objectStore = createMemoryObjectStore();
    const fileName = `overlay-${randomUUID()}.dts`;
    const auth = makeAuth();

    const uploaded = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-struct-int",
      fileName,
      bytes: Buffer.from(uploadableSample, "utf8"),
    });

    await db!.query(
      `
      update project_parameter_values
      set source_file_name = $1
      where project_id = 'project-struct-int'
        and source_node_path is not null
      `,
      [uploaded.file.fileName]
    );
    await db!.query(`delete from parameter_drafts where project_id = 'project-struct-int'`);

    const nodes = await db!.query<{ node_path: string }>(
      `select node_path from dts_nodes where file_version_id = $1`,
      [uploaded.version.id],
    );
    expect(nodes.rows.map((r) => r.node_path)).toEqual(
      expect.arrayContaining([
        "demo_multi_instance/battery_checker@0",
        "demo_multi_instance/battery_checker@1",
      ]),
    );

    // Re-sync is a no-op summary check; upload already synced when supported.
    const sync = await syncFileVersion(db!, auth, {
      fileId: uploaded.file.id,
      versionId: uploaded.version.id,
    });
    expect(sync.skipped).toBe(false);

    const drafts = await db!.query<{ target_value: string; reason: string }>(
      `
      select target_value, reason from parameter_drafts
      where project_id = 'project-struct-int' and origin = 'file_sync'
      `,
    );
    // @1 status differs (disabled → ok) so a draft must exist for the addressed path
    expect(drafts.rows.some((d) => d.reason.includes("battery_checker@1/status"))).toBe(true);
    expect(drafts.rows.some((d) => d.reason.includes("battery_checker@0/status"))).toBe(false);
  });

  it("hex / multi-group equivalent rewrites do not create false-diff drafts", async () => {
    const objectStore = createMemoryObjectStore();
    const auth = makeAuth();
    const fileName = `hex-${randomUUID()}.dts`;
    const v1 = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-struct-int",
      fileName,
      bytes: Buffer.from(
        `&amba {
	i2c@XXXX0000 {
		mixed_case_reg = /bits/ 8 <0xAB 0xCD 0xef 0x12>;
		combined_para = <1 2>,<3 4>;
	};
};
`,
        "utf8",
      ),
    });

    // Clear drafts from first upload
    await db!.query(`delete from parameter_drafts where project_id = 'project-struct-int'`);

    // Bind source for hex property and set current to normalized form
    await db!.query(
      `
      update project_parameter_values
      set current_value = $1, source_file_name = $2, source_node_path = $3
      where id = 'ppv-hex'
      `,
      [
        buildDtsParsedIndex(
          `&amba { i2c@XXXX0000 { mixed_case_reg = /bits/ 8 <0xab 0xcd 0xef 0x12>; }; };`,
        )["amba/i2c@XXXX0000/mixed_case_reg"]?.value,
        fileName,
        "amba/i2c@XXXX0000/mixed_case_reg",
      ],
    );

    const v2 = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-struct-int",
      fileName,
      bytes: Buffer.from(
        `&amba {
	i2c@XXXX0000 {
		mixed_case_reg = /bits/ 8 <0xab 0xcd 0xEF 0x12>;
		combined_para = <1 2 3 4>;
	};
};
`,
        "utf8",
      ),
    });

    expect(v2.version.versionNumber).toBeGreaterThan(v1.version.versionNumber);
    const hexDrafts = await db!.query<{ id: string }>(
      `
      select id from parameter_drafts
      where project_parameter_value_id = 'ppv-hex' and origin = 'file_sync'
        and origin_file_version_id = $1
      `,
      [v2.version.id],
    );
    expect(hexDrafts.rows).toHaveLength(0);
  });

  it("CST writeback then re-parse stays lossless around the edited property", async () => {
    const patched = patchDtsProperty(uploadableSample, "demo_integer/single_value", "<99>");
    const text = patched.toString("utf8");
    expect(text).toContain("single_value = <99>;");
    expect(serializeDts(parseDts(text))).toBe(text);
    expect(buildDtsParsedIndex(text)["demo_integer/single_value"]?.value).toBe("<99>");
  });
});
