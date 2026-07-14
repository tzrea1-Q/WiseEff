import { describe, expect, it } from "vitest";

import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import { createMockDtsStructuredRepository } from "./mockDtsStructuredRepository";

const PROJECT_ID = "project-teaching";
const FILE_ID = "file-teaching-dts";
const VERSION_ID = "version-teaching-1";

describe("createMockDtsStructuredRepository (DtsStructuredRepository contract)", () => {
  function createRepo(): DtsStructuredRepository {
    return createMockDtsStructuredRepository();
  }

  it("getStructure returns teaching fixture-derived nodes with path, bool, and phandle refs", async () => {
    const repo = createRepo();
    const { nodes } = await repo.getStructure(PROJECT_ID, FILE_ID, VERSION_ID);

    const chip = nodes.find((node) => node.nodePath === "amba/i2c@XXXX0000/chip@6E");
    expect(chip).toMatchObject({
      name: "chip",
      unitAddress: "6E",
      compatible: "vendor,chip123"
    });

    const battery = nodes.find((node) => node.nodePath === "demo_multi_instance/battery_checker@0");
    expect(battery).toBeDefined();

    const demoBool = nodes.find((node) => node.nodePath === "demo_bool");
    expect(demoBool?.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "weak_source_sleep_enabled",
          valueType: "bool",
          normalizedValue: "true"
        })
      ])
    );

    const phandleList = nodes.find((node) => node.nodePath === "demo_phandle_list");
    const resolved = phandleList?.phandleRefs.find((ref) => ref.targetLabel === "demo_ic_a");
    const unresolved = phandleList?.phandleRefs.find((ref) => ref.targetLabel === "demo_ic_b");
    expect(resolved?.resolvedTargetPath).toEqual(expect.any(String));
    expect(unresolved).toBeDefined();
    expect(unresolved?.resolvedTargetPath).toBeUndefined();
  });

  it("search filters teaching structure by path/label/compatible", async () => {
    const repo = createRepo();

    const byPath = await repo.search(PROJECT_ID, { q: "chip@6E", by: "path" });
    expect(byPath.items.some((hit) => hit.nodePath === "amba/i2c@XXXX0000/chip@6E")).toBe(true);

    const byCompatible = await repo.search(PROJECT_ID, { q: "vendor,chip123", by: "compatible" });
    expect(byCompatible.items.some((hit) => hit.nodePath === "amba/i2c@XXXX0000/chip@6E")).toBe(true);

    const byLabel = await repo.search(PROJECT_ID, { q: "demo_bool", by: "label" });
    expect(byLabel.items.some((hit) => hit.nodePath === "demo_bool")).toBe(true);
  });

  it("supports interactive config-set membership CRUD", async () => {
    const repo = createRepo();

    const created = await repo.createConfigSet(PROJECT_ID, { name: "board-a", description: "A board" });
    expect(created.name).toBe("board-a");
    expect(created.projectId).toBe(PROJECT_ID);

    const listed = await repo.listConfigSets(PROJECT_ID);
    expect(listed.some((item) => item.id === created.id)).toBe(true);

    const membership = await repo.addConfigSetFile(PROJECT_ID, created.id, {
      fileId: FILE_ID,
      role: "base",
      sortOrder: 1
    });
    expect(membership).toMatchObject({ configSetId: created.id, fileId: FILE_ID, role: "base", sortOrder: 1 });

    await repo.removeConfigSetFile(PROJECT_ID, created.id, FILE_ID);
    const afterRemove = await repo.listConfigSets(PROJECT_ID);
    const stillThere = afterRemove.find((item) => item.id === created.id);
    expect(stillThere).toBeDefined();
  });

  it("supports baseline create/release/compare/rollback and export", async () => {
    const repo = createRepo();
    const configSet = await repo.createConfigSet(PROJECT_ID, { name: "board-b" });
    await repo.addConfigSetFile(PROJECT_ID, configSet.id, { fileId: FILE_ID, role: "base" });

    const baseline = await repo.createBaseline(PROJECT_ID, configSet.id, { name: "v1.0", notes: "initial" });
    expect(baseline).toMatchObject({ configSetId: configSet.id, name: "v1.0", status: "draft" });

    const listed = await repo.listBaselines(PROJECT_ID, configSet.id);
    expect(listed.some((item) => item.id === baseline.id)).toBe(true);

    const released = await repo.releaseBaseline(PROJECT_ID, baseline.id);
    expect(released.item.status).toBe("released");
    expect(released.gate).toMatchObject({
      ok: expect.any(Boolean),
      requiresConfirmation: expect.any(Boolean)
    });

    const comparison = await repo.compareBaseline(PROJECT_ID, baseline.id);
    expect(comparison.baselineId).toBe(baseline.id);
    expect(comparison.members.length).toBeGreaterThan(0);
    expect(comparison.members[0].structuralDiff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: expect.stringMatching(/^(node_|prop_)/) })
      ])
    );

    const rollback = await repo.rollbackBaseline(PROJECT_ID, baseline.id);
    expect(rollback).toMatchObject({ baselineId: baseline.id, restored: expect.any(Number) });

    const exported = await repo.exportConfigSet(PROJECT_ID, configSet.id);
    expect(exported.manifest.configSetId).toBe(configSet.id);
    expect(exported.files).toEqual(expect.any(Array));
    expect(exported).not.toHaveProperty("item");
  });
});
