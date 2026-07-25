import { describe, expect, it } from "vitest";
import { createMockParameterModuleRegistryRepository } from "./mockParameterModuleRegistryRepository";

describe("createMockParameterModuleRegistryRepository", () => {
  it("seeds a semantic module tree and driver mapping", async () => {
    const repo = createMockParameterModuleRegistryRepository();
    const registry = await repo.getRegistry();

    expect(registry.modules.some((module) => module.name === "充电策略")).toBe(true);
    expect(registry.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ matchKind: "driver", matchValue: "sc8562" })
      ])
    );
  });

  it("supports create, rename, move, delete, mapping, and recompute", async () => {
    const repo = createMockParameterModuleRegistryRepository();

    let registry = await repo.createModule({ name: "电源路径", importance: "low" });
    const created = registry.modules.find((module) => module.name === "电源路径");
    expect(created).toBeTruthy();

    registry = await repo.updateModule(created!.id, { name: "电源路径组" });
    expect(registry.modules.find((module) => module.id === created!.id)?.name).toBe("电源路径组");

    registry = await repo.updateModule(created!.id, { parentId: "mod-charging" });
    expect(registry.modules.find((module) => module.id === created!.id)?.parentId).toBe("mod-charging");

    registry = await repo.createMapping({
      moduleId: "mod-charging",
      matchKind: "compatible",
      matchValue: "vendor,demo"
    });
    const mapping = registry.mappings.find((item) => item.matchValue === "vendor,demo");
    expect(mapping).toBeTruthy();

    registry = await repo.deleteMapping(mapping!.id);
    expect(registry.mappings.some((item) => item.id === mapping!.id)).toBe(false);

    registry = await repo.deleteModule(created!.id);
    expect(registry.modules.some((module) => module.id === created!.id)).toBe(false);

    const recompute = await repo.recomputeBindings();
    expect(recompute.updated).toBeGreaterThan(0);
  });
});
