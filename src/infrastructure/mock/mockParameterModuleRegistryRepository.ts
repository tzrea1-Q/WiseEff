import type {
  CreateModuleMappingInput,
  CreateParameterModuleInput,
  MappingApplyPreview,
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
  dismissed: string[];
  recomputeResult: RecomputeBindingModulesResult;
};

function cloneRegistry(store: Store): ParameterModuleRegistry {
  return {
    modules: store.modules.map((module) => ({ ...module })),
    mappings: store.mappings.map((mapping) => ({ ...mapping }))
  };
}

function emptyPreview(toModuleId: string | null = null): MappingApplyPreview {
  return {
    affectedBindings: 0,
    byProject: [],
    fromModules: [],
    toModuleId,
    emptiedModules: [],
    conflicts: []
  };
}

function cloneDiscovery(store: Store): ModuleDiscoveryHints {
  const dismissed = new Set(store.dismissed.map((value) => value.toLowerCase()));
  const compatibles = store.discovery.compatibles.filter(
    (hint) => !dismissed.has(hint.compatible.toLowerCase())
  );
  return {
    compatibles: compatibles.map((hint) => ({ ...hint })),
    total: compatibles.length
  };
}

function createSeedStore(): Store {
  return {
    modules: [
      {
        id: "mod-charging",
        name: "充电策略",
        parentId: null,
        sortOrder: 0,
        importance: "high",
        kind: "business",
        origin: "curated",
        sourceKey: null,
        effectiveImportance: "high",
        parameterCount: 12
      },
      {
        id: "mod-battery",
        name: "电池安全",
        parentId: "mod-charging",
        sortOrder: 1,
        importance: "medium",
        kind: "business",
        origin: "curated",
        sourceKey: null,
        effectiveImportance: "high",
        parameterCount: 4
      }
    ],
    mappings: [
      {
        id: "map-sc8562-compatible",
        moduleId: "mod-charging",
        matchKind: "compatible",
        matchValue: "vendor,sc8562",
        priority: 100
      }
    ],
    discovery: {
      compatibles: [
        {
          compatible: "vendor,unmapped-ic",
          bindingCount: 2,
          projectCount: 1,
          suggestedGroupName: "unmapped-ic"
        }
      ],
      total: 1
    },
    dismissed: [],
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
    discovery: seed.discovery
      ? {
          compatibles: seed.discovery.compatibles.map((hint) => ({ ...hint })),
          total: seed.discovery.total
        }
      : base.discovery,
    dismissed: seed.dismissed ? [...seed.dismissed] : [],
    recomputeResult: seed.recomputeResult ?? base.recomputeResult
  };
  let moduleSeq = 0;
  let mappingSeq = 0;

  return {
    async getRegistry() {
      return cloneRegistry(store);
    },

    async getDiscoveryHints() {
      return cloneDiscovery(store);
    },

    async dismissCompatible(input) {
      const key = input.compatible.trim().toLowerCase();
      if (!store.dismissed.some((value) => value.toLowerCase() === key)) {
        store.dismissed.push(input.compatible.trim());
      }
      return cloneDiscovery(store);
    },

    async restoreDismissedCompatible(compatible: string) {
      const key = compatible.trim().toLowerCase();
      store.dismissed = store.dismissed.filter((value) => value.toLowerCase() !== key);
      return cloneDiscovery(store);
    },

    async createModule(input: CreateParameterModuleInput) {
      moduleSeq += 1;
      const importance = input.importance ?? "medium";
      store.modules.push({
        id: `mod-mock-${moduleSeq}`,
        name: input.name,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder ?? store.modules.length,
        importance,
        kind: "business",
        origin: "curated",
        sourceKey: null,
        effectiveImportance: importance,
        parameterCount: 0
      });
      return cloneRegistry(store);
    },

    async updateModule(moduleId: string, input: UpdateParameterModuleInput) {
      const target = store.modules.find((module) => module.id === moduleId);
      if (!target) {
        throw new Error(`Module not found: ${moduleId}`);
      }
      if (input.name !== undefined) {
        target.name = input.name;
        if (target.origin === "auto") target.origin = "curated";
      }
      if (input.parentId !== undefined) {
        target.parentId = input.parentId;
        if (target.origin === "auto") target.origin = "curated";
      }
      if (input.sortOrder !== undefined) target.sortOrder = input.sortOrder;
      if (input.importance !== undefined) {
        target.importance = input.importance;
        target.effectiveImportance = input.importance;
        if (target.origin === "auto") target.origin = "curated";
      }
      return cloneRegistry(store);
    },

    async deleteModule(moduleId: string) {
      store.modules = store.modules.filter((module) => module.id !== moduleId);
      store.mappings = store.mappings.filter((mapping) => mapping.moduleId !== moduleId);
      return cloneRegistry(store);
    },

    async previewMapping(input: CreateModuleMappingInput) {
      return {
        ...emptyPreview(input.moduleId),
        affectedBindings: input.matchKind === "compatible" ? 2 : 1
      };
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
      store.discovery.compatibles = store.discovery.compatibles.filter(
        (hint) => hint.compatible.toLowerCase() !== input.matchValue.trim().toLowerCase()
      );
      store.discovery.total = store.discovery.compatibles.length;
      return {
        registry: cloneRegistry(store),
        apply: {
          ...emptyPreview(input.moduleId),
          affectedBindings: 2
        }
      };
    },

    async deleteMapping(mappingId: string) {
      store.mappings = store.mappings.filter((mapping) => mapping.id !== mappingId);
      return {
        registry: cloneRegistry(store),
        apply: emptyPreview(null)
      };
    },

    async recomputeBindings(input?: { projectId?: string; dryRun?: boolean }) {
      if (input?.dryRun) {
        return {
          updated: store.recomputeResult.updated,
          conflicts: [...store.recomputeResult.conflicts],
          dryRun: true,
          preview: {
            ...emptyPreview(null),
            affectedBindings: store.recomputeResult.updated
          }
        };
      }
      return { ...store.recomputeResult, conflicts: [...store.recomputeResult.conflicts] };
    }
  };
}
