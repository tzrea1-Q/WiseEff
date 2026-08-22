/**
 * Behavior-level coverage for change-request impact analysis: the legacy
 * two-item template fallback and the structural DTS path (phandle references,
 * compatible peers, config-set variants) against a real database. Asserts
 * returned impact items — never SQL text.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { buildChangeRequestImpact, buildTemplateImpact } from "./impact";

const databaseAvailable = await isTestDatabaseAvailable();

const templateInput = {
  title: "status",
  module: "demo_multi_instance/battery_checker@0",
  currentValue: '"ok"',
  targetValue: '"disabled"',
  risk: "Medium" as const
};

describe("buildTemplateImpact", () => {
  it("returns the exact legacy two-item template", () => {
    expect(buildTemplateImpact(templateInput)).toEqual([
      {
        kind: "parameter",
        name: "status",
        note: `将 demo_multi_instance/battery_checker@0 模块的参数值从 "ok" 调整为 "disabled"。`,
        risk: "Medium"
      },
      {
        kind: "module",
        name: "demo_multi_instance/battery_checker@0",
        note: "建议对中风险模块变更进行审阅。",
        risk: "Medium"
      }
    ]);
  });
});

describe.skipIf(!databaseAvailable)("buildChangeRequestImpact", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
      projects: [
        { id: "project-1", name: "Aurora", code: "AUR" },
        { id: "project-2", name: "Borealis", code: "BOR" }
      ]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function seedFile(input: {
    id: string;
    projectId?: string;
    fileName: string;
    configSetId?: string | null;
    sortOrder?: number;
  }) {
    await db.query(
      `insert into project_parameter_files (
         id, organization_id, project_id, file_name, format, config_set_id, config_set_sort_order
       ) values ($1, 'org-1', $2, $3, 'dts', $4, $5)`,
      [input.id, input.projectId ?? "project-1", input.fileName, input.configSetId ?? null, input.sortOrder ?? 0]
    );
  }

  async function seedCurrentVersion(input: { id: string; fileId: string }) {
    await db.query(
      `insert into project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, origin, created_by_user_id
       ) values ($1, $2, 1, $3, 'checksum', 100, 'upload', 'user-1')`,
      [input.id, input.fileId, `org-1/${input.id}`]
    );
    await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
      input.id,
      input.fileId
    ]);
  }

  async function seedNode(input: {
    id: string;
    fileVersionId: string;
    nodePath: string;
    compatible?: string | null;
  }) {
    await db.query(
      `insert into dts_nodes (id, file_version_id, name, node_path, compatible)
       values ($1, $2, $3, $4, $5)`,
      [
        input.id,
        input.fileVersionId,
        input.nodePath.split("/").filter(Boolean).at(-1) ?? "node",
        input.nodePath,
        input.compatible ?? null
      ]
    );
  }

  function impactInput(overrides: Partial<Parameters<typeof buildChangeRequestImpact>[1]> = {}) {
    return {
      ...templateInput,
      projectId: "project-1",
      projectParameterValueId: "ppv-1",
      sourceFileName: "board.dts",
      sourceNodePath: "amba/i2c@1/chip@6E/status",
      ...overrides
    };
  }

  it("falls back to template when source binding is missing", async () => {
    const impact = await buildChangeRequestImpact(db, impactInput({ sourceFileName: null, sourceNodePath: null }));
    expect(impact).toEqual(buildTemplateImpact(templateInput));
  });

  it("falls back to template when the source file and node have no dts rows", async () => {
    // The file exists with a current version, but no node matches the source path.
    await seedFile({ id: "file-board", fileName: "board.dts" });
    await seedCurrentVersion({ id: "ver-1", fileId: "file-board" });

    const impact = await buildChangeRequestImpact(db, impactInput());
    expect(impact).toEqual(buildTemplateImpact(templateInput));
  });

  it("includes phandle, compatible, and config-set impact kinds for structural changes", async () => {
    await db.query(
      `insert into dts_config_set (id, organization_id, project_id, name)
       values ('cs-default', 'org-1', 'project-1', 'default')`
    );
    await seedFile({ id: "file-board", fileName: "board.dts", configSetId: "cs-default", sortOrder: 0 });
    await seedCurrentVersion({ id: "ver-1", fileId: "file-board" });
    // Config-set peers, inserted out of sort order to prove database ordering;
    // a file in another config set stays out.
    await seedFile({ id: "file-sku-b", fileName: "board-sku-b.dts", configSetId: "cs-default", sortOrder: 2 });
    await seedFile({ id: "file-overlay", fileName: "board-overlay.dts", configSetId: "cs-default", sortOrder: 1 });
    await seedFile({ id: "file-other-set", fileName: "other-set.dts", configSetId: null });
    // A same-named file in another project must not shadow the bound node.
    await seedFile({ id: "file-foreign", projectId: "project-2", fileName: "board.dts" });
    await seedCurrentVersion({ id: "ver-foreign", fileId: "file-foreign" });
    await seedNode({ id: "node-foreign", fileVersionId: "ver-foreign", nodePath: "amba/i2c@1/chip@6E" });

    await seedNode({
      id: "node-chip",
      fileVersionId: "ver-1",
      nodePath: "amba/i2c@1/chip@6E",
      compatible: "vendor,chip123"
    });
    await seedNode({
      id: "node-peer",
      fileVersionId: "ver-1",
      nodePath: "amba/i2c@2/chip@70",
      compatible: "vendor,chip123"
    });
    // Different compatible: not a peer.
    await seedNode({
      id: "node-other-compat",
      fileVersionId: "ver-1",
      nodePath: "amba/i2c@3/chip@99",
      compatible: "vendor,other"
    });
    await seedNode({ id: "node-consumer", fileVersionId: "ver-1", nodePath: "amba/consumer" });
    await db.query(
      `insert into dts_properties (id, node_id, name, value_type, raw_text, normalized_value)
       values
         ('prop-handle', 'node-consumer', 'chip-handle', 'phandle', '<&chip_label>', '<&chip_label>'),
         ('prop-unrelated', 'node-consumer', 'other-handle', 'phandle', '<&other>', '<&other>')`
    );
    // Only references resolved to the bound node count; the unrelated ref targets a peer.
    await db.query(
      `insert into dts_phandle_refs (id, from_property_id, target_label, resolved_target_node_id)
       values
         ('ref-1', 'prop-handle', 'chip_label', 'node-chip'),
         ('ref-2', 'prop-unrelated', 'other', 'node-peer')`
    );

    const impact = await buildChangeRequestImpact(db, impactInput());

    // Structural results replace the legacy module filler but keep the parameter item.
    expect(impact).toEqual([
      buildTemplateImpact(templateInput)[0],
      {
        kind: "phandle",
        name: "amba/consumer",
        note: "通过 chip-handle → chip_label 的 phandle 引用指向 amba/i2c@1/chip@6E。",
        risk: "Medium"
      },
      {
        kind: "compatible",
        name: "amba/i2c@2/chip@70",
        note: "与 amba/i2c@1/chip@6E 共用 compatible「vendor,chip123」。",
        risk: "Medium"
      },
      {
        kind: "config-set",
        name: "board-overlay.dts",
        note: "与 board.dts 属于同一配置集变体。",
        risk: "Medium"
      },
      {
        kind: "config-set",
        name: "board-sku-b.dts",
        note: "与 board.dts 属于同一配置集变体。",
        risk: "Medium"
      }
    ]);
  });

  it("falls back to template when structural queries all return empty", async () => {
    // The node is bound, but it has no compatible, no config set, and no inbound phandles.
    await seedFile({ id: "file-board", fileName: "board.dts" });
    await seedCurrentVersion({ id: "ver-1", fileId: "file-board" });
    await seedNode({ id: "node-lonely", fileVersionId: "ver-1", nodePath: "lonely" });

    const impact = await buildChangeRequestImpact(db, impactInput({ sourceNodePath: "lonely/status" }));
    expect(impact).toEqual(buildTemplateImpact(templateInput));
  });
});
