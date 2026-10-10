import { describe, expect, it } from "vitest";
import { createMockParameterModuleRegistryRepository } from "./mockParameterModuleRegistryRepository";

describe("createMockParameterModuleRegistryRepository", () => {
  it("refuses identity writes through taxonomy CRUD", async () => {
    const repo = createMockParameterModuleRegistryRepository();
    const before = await repo.getRegistry();
    await expect(repo.createModule({ name: "Driver", kind: "driver-group" }))
      .rejects.toMatchObject({ code: "LEGACY_SURFACE_RETIRED" });
    await expect(repo.updateModule("mod-charging", { kind: "node-type" }))
      .rejects.toMatchObject({ code: "LEGACY_SURFACE_RETIRED" });
    expect(await repo.getRegistry()).toEqual(before);
    const history = createMockParameterModuleRegistryRepository({
      modules: [{ ...before.modules[0]!, id: "historical-driver", kind: "driver-group" }]
    });
    await expect(history.updateModule("historical-driver", { name: "Changed identity" }))
      .rejects.toMatchObject({ code: "LEGACY_SURFACE_RETIRED" });
    await expect(history.deleteModule("historical-driver"))
      .rejects.toMatchObject({ code: "LEGACY_SURFACE_RETIRED" });
  });
  it("seeds business taxonomy without identity teaching fixtures", async () => {
    const repo = createMockParameterModuleRegistryRepository();
    const registry = await repo.getRegistry();

    expect(registry.modules.some((module) => module.name === "充电策略")).toBe(true);
    expect(registry.modules[0]).toEqual(
      expect.objectContaining({
        kind: "business",
        origin: "curated",
        effectiveImportance: "high",
        parameterCount: 16,
        definitionCount: 16
      })
    );
    expect(registry.mappings).toEqual([]);
    expect(registry.modules.every((module) => module.kind === "business")).toBe(true);
    expect(await repo.listDriverRegistry()).toEqual({ items: [], total: 0 });
  });

  it("supports business taxonomy create, rename, move and delete", async () => {
    const repo = createMockParameterModuleRegistryRepository();

    let registry = await repo.createModule({
      name: "电源路径",
      importance: "low",
      description: "路径管理",
      scope: "组织"
    });
    const created = registry.modules.find((module) => module.name === "电源路径");
    expect(created).toEqual(
      expect.objectContaining({
        description: "路径管理",
        scope: "组织",
        importance: "low"
      })
    );

    registry = await repo.updateModule(created!.id, {
      name: "电源路径组",
      description: "更新描述",
      scope: "项目"
    });
    expect(registry.modules.find((module) => module.id === created!.id)).toEqual(
      expect.objectContaining({
        name: "电源路径组",
        description: "更新描述",
        scope: "项目"
      })
    );

    registry = await repo.updateModule(created!.id, { parentId: "mod-charging" });
    expect(registry.modules.find((module) => module.id === created!.id)?.parentId).toBe("mod-charging");

    registry = await repo.deleteModule(created!.id);
    expect(registry.modules.some((module) => module.id === created!.id)).toBe(false);

  });
});
