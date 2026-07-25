import type {
  CreateModuleMappingInput,
  CreateParameterModuleInput,
  ModuleDiscoveryHints,
  ParameterModuleRegistryRepository,
  RecomputeBindingModulesResult,
  UpdateParameterModuleInput
} from "@/application/ports/ParameterModuleRegistryRepository";
import type {
  ParameterModule,
  ParameterModuleMapping,
  ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";

type Store = {
  modules: ParameterModule[];
  mappings: ParameterModuleMapping[];
  discovery: ModuleDiscoveryHints;
  recomputeResult: RecomputeBindingModulesResult;
};

function cloneRegistry(store: Store): ParameterModuleRegistry {
  return {
    modules: store.modules.map((module) => ({ ...module })),
    mappings: store.mappings.map((mapping) => ({ ...mapping }))
  };
}

function createSeedStore(): Store {
  return {
    modules: [
      { id: "mod-charging", name: "充电策略", parentId: null, sortOrder: 0, importance: "high" },
      { id: "mod-battery", name: "电池安全", parentId: "mod-charging", sortOrder: 1, importance: "medium" }
    ],
    mappings: [
      {
        id: "map-sc8562-driver",
        moduleId: "mod-charging",
        matchKind: "driver",
        matchValue: "sc8562",
        priority: 100
      }
    ],
    discovery: {
      compatibles: [{ compatible: "vendor,unmapped-ic", bindingCount: 2 }]
    },
    recomputeResult: { updated: 2, conflicts: [] }
  };
}

/**
 * Mock adapter for ParameterModuleRegistryRepository (ADR-0002).
 * Same semantic model as the HTTP client — fixtures, not a separate product.
 */
export function createMockParameterModuleRegistryRepository(
  seed: Partial<Store> = {}
): ParameterModuleRegistryRepository {
  const base = createSeedStore();
  const store: Store = {
    modules: seed.modules ? seed.modules.map((module) => ({ ...module })) : base.modules,
    mappings: seed.mappings ? seed.mappings.map((mapping) => ({ ...mapping })) : base.mappings,
    discovery: seed.discovery ?? base.discovery,
    recomputeResult: seed.recomputeResult ?? base.recomputeResult
  };
  let moduleSeq = 0;
  let mappingSeq = 0;

  return {
    async getRegistry() {
      return cloneRegistry(store);
    },

    async getDiscoveryHints() {
      return {
        compatibles: store.discovery.compatibles.map((hint) => ({ ...hint }))
      };
    },

    async createModule(input: CreateParameterModuleInput) {
      moduleSeq += 1;
      store.modules.push({
        id: `mod-mock-${moduleSeq}`,
        name: input.name,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder ?? store.modules.length,
        importance: input.importance ?? "medium"
      });
      return cloneRegistry(store);
    },

    async updateModule(moduleId: string, input: UpdateParameterModuleInput) {
      const target = store.modules.find((module) => module.id === moduleId);
      if (!target) {
        throw new Error(`Module not found: ${moduleId}`);
      }
      if (input.name !== undefined) target.name = input.name;
      if (input.parentId !== undefined) target.parentId = input.parentId;
      if (input.sortOrder !== undefined) target.sortOrder = input.sortOrder;
      if (input.importance !== undefined) target.importance = input.importance;
      return cloneRegistry(store);
    },

    async deleteModule(moduleId: string) {
      store.modules = store.modules.filter((module) => module.id !== moduleId);
      store.mappings = store.mappings.filter((mapping) => mapping.moduleId !== moduleId);
      return cloneRegistry(store);
    },

    async createMapping(input: CreateModuleMappingInput) {
      mappingSeq += 1;
      store.mappings.push({
        id: `map-mock-${mappingSeq}`,
        moduleId: input.moduleId,
        matchKind: input.matchKind,
        matchValue: input.matchValue,
        priority: input.priority ?? 0
      });
      return cloneRegistry(store);
    },

    async deleteMapping(mappingId: string) {
      store.mappings = store.mappings.filter((mapping) => mapping.id !== mappingId);
      return cloneRegistry(store);
    },

    async recomputeBindings(_input?: { projectId?: string }) {
      return { ...store.recomputeResult, conflicts: [...store.recomputeResult.conflicts] };
    }
  };
}
