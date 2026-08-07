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

  it("getStructure returns teaching fixture-derived nodes with path, bool, phandle refs, and source locators", async () => {
    const repo = createRepo();
    const { nodes } = await repo.getStructure(PROJECT_ID, FILE_ID, VERSION_ID);

    const anyIds = await repo.getStructure("any-project", "any-file", "any-version");
    expect(anyIds.nodes.length).toBe(nodes.length);
    expect(anyIds.nodes.some((item) => item.nodePath === "demo_regulator")).toBe(true);

    const chip = nodes.find((node) => node.nodePath === "amba/i2c@XXXX0000/chip@6E");
    expect(chip?.source?.startOffset).toBeLessThan(chip!.source!.endOffset);
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

  it("search returns hits shaped for path/address/label/compatible/value", async () => {
    const repo = createRepo();

    const byPath = await repo.search(PROJECT_ID, { q: "chip@6E", by: "path" });
    expect(byPath.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileId: FILE_ID,
          fileName: "atlas-board.dts",
          versionId: VERSION_ID,
          nodePath: "amba/i2c@XXXX0000/chip@6E"
        })
      ])
    );

    const byAddress = await repo.search(PROJECT_ID, { q: "6E", by: "address" });
    expect(byAddress.hits.some((hit) => hit.nodePath === "amba/i2c@XXXX0000/chip@6E")).toBe(true);

    const byCompatible = await repo.search(PROJECT_ID, { q: "vendor,chip123", by: "compatible" });
    expect(byCompatible.hits.some((hit) => hit.nodePath === "amba/i2c@XXXX0000/chip@6E")).toBe(true);

    const byLabel = await repo.search(PROJECT_ID, { q: "demo_bool", by: "label" });
    expect(byLabel.hits.some((hit) => hit.nodePath === "demo_bool")).toBe(true);

    const byValue = await repo.search(PROJECT_ID, { q: "true", by: "value" });
    expect(byValue.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodePath: "demo_bool",
          propertyName: "weak_source_sleep_enabled",
          snippet: expect.any(String)
        })
      ])
    );
  });

  it("browse and search describe the same nodes for any project id", async () => {
    const repo = createRepo();
    const otherProject = "project-not-the-fixture-owner";

    const { nodes } = await repo.getStructure(otherProject, FILE_ID, VERSION_ID);
    expect(nodes.length).toBeGreaterThan(0);

    for (const node of nodes) {
      const found = await repo.search(otherProject, { q: node.nodePath, by: "path" });
      expect(found.hits.map((hit) => hit.nodePath)).toContain(node.nodePath);
    }

    const byLabel = await repo.search(otherProject, { q: "demo_regulator", by: "label" });
    expect(byLabel.hits.length).toBeGreaterThan(0);
    const browsedPaths = new Set(nodes.map((node) => node.nodePath));
    for (const hit of byLabel.hits) {
      expect(browsedPaths.has(hit.nodePath)).toBe(true);
    }
  });

  it("supports interactive config-set membership CRUD", async () => {
    const repo = createRepo();

    const [defaultConfigSet] = await repo.listConfigSets(PROJECT_ID);
    expect(defaultConfigSet?.name).toBe("default");
    expect(await repo.listConfigSetFiles(PROJECT_ID, defaultConfigSet!.id)).toEqual([
      expect.objectContaining({
        configSetId: defaultConfigSet!.id,
        fileId: FILE_ID,
        fileName: "atlas-board.dts",
        format: "dts",
        role: "base",
        currentVersionId: VERSION_ID,
        currentVersionNumber: 1
      })
    ]);

    await repo.removeConfigSetFile(PROJECT_ID, defaultConfigSet!.id, FILE_ID);

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
    expect(await repo.listConfigSetFiles(PROJECT_ID, created.id)).toEqual([
      expect.objectContaining({
        fileId: FILE_ID,
        fileName: "atlas-board.dts",
        currentVersionId: VERSION_ID
      })
    ]);

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

  it("submitStructuredEdits returns a mock submission round with CR items using rawText", async () => {
    const repo = createRepo();
    const rawText = "/bits/ 8 <0xAB 0xCD 0xEF 0x12>";

    const round = await repo.submitStructuredEdits(PROJECT_ID, {
      edits: [
        {
          fileId: FILE_ID,
          nodePath: "amba/i2c@XXXX0000",
          propertyName: "mixed_case_reg",
          rawText,
          reason: "mock structured submit"
        }
      ],
      reason: "P3.1 mock submit"
    });

    expect(round.projectId).toBe(PROJECT_ID);
    expect(round.status).toBe("submitted");
    expect(round.items).toHaveLength(1);
    expect(round.items[0]?.targetValue).toBe(rawText);
    expect(round.items[0]?.parameterId).toEqual(expect.any(String));
    expect(round.items[0]?.reason).toContain("mock structured submit");

    // Second submit stays interactive (new round id).
    const again = await repo.submitStructuredEdits(PROJECT_ID, {
      edits: [
        {
          fileId: FILE_ID,
          nodePath: "demo_integer",
          propertyName: "single_value",
          rawText: "<99>"
        }
      ]
    });
    expect(again.id).not.toBe(round.id);
    expect(again.items[0]?.targetValue).toBe("<99>");
  });
  it("search matches file names, returns source locators, and searches all dimensions when by is omitted", async () => {
    const repo = createMockDtsStructuredRepository();
    const byFile = await repo.search(PROJECT_ID, { q: "atlas-board", by: "file" });
    expect(byFile.hits.length).toBeGreaterThan(0);
    expect(byFile.hits[0]?.fileName).toContain("atlas-board");

    const byPath = await repo.search(PROJECT_ID, { q: "chip@6E", by: "path" });
    expect(byPath.hits[0]?.source?.startOffset).toBeLessThan(byPath.hits[0]!.source!.endOffset);

    const all = await repo.search(PROJECT_ID, { q: "atlas-board" });
    expect(all.hits.some((hit) => hit.fileName.includes("atlas-board"))).toBe(true);
  });

});
