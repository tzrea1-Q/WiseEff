import { describe, expect, it } from "vitest";
import { createMockParameterModuleRegistryRepository } from "./mockParameterModuleRegistryRepository";

describe("createMockParameterModuleRegistryRepository", () => {
  it("seeds a semantic module tree and driver mapping", async () => {
    const repo = createMockParameterModuleRegistryRepository();
    const registry = await repo.getRegistry();

    expect(registry.modules.some((module) => module.name === "充电策略")).toBe(true);
    expect(registry.modules[0]).toEqual(
      expect.objectContaining({
        kind: "business",
        origin: "curated",
        effectiveImportance: "high",
        parameterCount: 12
      })
    );
    expect(registry.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ matchKind: "compatible", matchValue: "vendor,sc8562" })
      ])
    );
  });

  it("supports create, rename, move, delete, mapping, preview, dismiss, and recompute", async () => {
    const repo = createMockParameterModuleRegistryRepository();

    let registry = await repo.createModule({ name: "电源路径", importance: "low" });
    const created = registry.modules.find((module) => module.name === "电源路径");
    expect(created).toBeTruthy();

    registry = await repo.updateModule(created!.id, { name: "电源路径组" });
    expect(registry.modules.find((module) => module.id === created!.id)?.name).toBe("电源路径组");

    registry = await repo.updateModule(created!.id, { parentId: "mod-charging" });
    expect(registry.modules.find((module) => module.id === created!.id)?.parentId).toBe("mod-charging");

    const preview = await repo.previewMapping({
      moduleId: "mod-charging",
      matchKind: "compatible",
      matchValue: "vendor,demo"
    });
    expect(preview.affectedBindings).toBeGreaterThan(0);

    const createdMapping = await repo.createMapping({
      moduleId: "mod-charging",
      matchKind: "compatible",
      matchValue: "vendor,demo"
    });
    const mapping = createdMapping.registry.mappings.find((item) => item.matchValue === "vendor,demo");
    expect(mapping).toBeTruthy();
    expect(createdMapping.apply.affectedBindings).toBe(2);

    const deletedMapping = await repo.deleteMapping(mapping!.id);
    expect(deletedMapping.registry.mappings.some((item) => item.id === mapping!.id)).toBe(false);

    registry = await repo.deleteModule(created!.id);
    expect(registry.modules.some((module) => module.id === created!.id)).toBe(false);

    let hints = await repo.getDiscoveryHints();
    expect(hints.compatibles.some((hint) => hint.compatible === "vendor,unmapped-ic")).toBe(true);
    hints = await repo.dismissCompatible({ compatible: "vendor,unmapped-ic" });
    expect(hints.compatibles).toHaveLength(0);
    hints = await repo.restoreDismissedCompatible("vendor,unmapped-ic");
    expect(hints.compatibles).toHaveLength(1);

    const recompute = await repo.recomputeBindings();
    expect(recompute.updated).toBeGreaterThan(0);
  });
});
