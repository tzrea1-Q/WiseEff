import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestModuleRegistryRepository } from "@/test/harness";
import type { ParameterModuleRegistry } from "@/domain/parameter-topology/moduleRegistry";
import { ParameterModuleMappingPanel } from "./ParameterModuleMappingPanel";

afterEach(() => cleanup());

describe("mock module registry withdrawal", () => {
  it.each(["/parameter-admin/modules", "/parameter-admin/modules/queue"])(
    "withdraws identity controls at %s while business taxonomy still works",
    async (pathname) => {
      const registry: ParameterModuleRegistry = {
        modules: [{
          id: "mod-business", name: "Power", parentId: null, sortOrder: 0,
          description: "Power taxonomy", scope: "organization", importance: "high",
          kind: "business", origin: "curated", sourceKey: null,
          effectiveImportance: "high", parameterCount: 0, definitionCount: 0
        }],
        mappings: []
      };
      const retiredWrites = {
        createMapping: vi.fn(), registerOrClaimDriver: vi.fn(), recomputeBindings: vi.fn()
      };
      const getDiscoveryHints = vi.fn().mockResolvedValue({
        compatibles: [{ compatible: "vendor,unregistered", bindingCount: 2,
          projectCount: 1, suggestedGroupName: "Unregistered driver" }],
        dismissedCompatibles: [], total: 1
      });
      const repository = {
        ...createTestModuleRegistryRepository({
        getRegistry: vi.fn().mockResolvedValue(registry),
        updateModule: vi.fn(async (moduleId, input) => ({
          ...registry,
          modules: registry.modules.map((module) => module.id === moduleId ? { ...module, ...input } : module)
        }))
        }),
        getDiscoveryHints,
        ...retiredWrites
      };
      render(<ParameterModuleMappingPanel canAdmin repository={repository} pathname={pathname} />);

      await screen.findByRole("region", { name: "历史驱动注册表" });
      expect(screen.queryAllByRole("button", { name: /全量重算|登记驱动|前往归类|归类|认领|忽略|恢复/ }))
        .toHaveLength(0);
      expect(repository.getDiscoveryHints).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "新建模块" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "修改模块 Power" }));
      const dialog = screen.getByRole("dialog", { name: "Power" });
      fireEvent.change(within(dialog).getByLabelText("模块名称"), { target: { value: "Power renamed" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
      await waitFor(() => expect(repository.updateModule).toHaveBeenCalledWith("mod-business", {
        name: "Power renamed", description: "Power taxonomy", scope: "organization", importance: "high"
      }));
      expect(await screen.findByRole("button", { name: "修改模块 Power renamed" })).toBeInTheDocument();
      expect(repository.createMapping).not.toHaveBeenCalled();
      expect(repository.registerOrClaimDriver).not.toHaveBeenCalled();
      expect(repository.recomputeBindings).not.toHaveBeenCalled();
    }
  );
});
