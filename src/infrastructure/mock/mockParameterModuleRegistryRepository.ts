import type {
  CreateParameterModuleInput,
  DriverRegistryEntry,
  ParameterModuleRegistryRepository,
  UpdateParameterModuleInput
} from "@/application/ports/ParameterModuleRegistryRepository";
import type {
  ParameterModule,
  ParameterModuleMapping,
  ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";
import { aggregateSubtreeAttributionCounts } from "@/components/parameter-topology/moduleAttributionTreeUtils";
import { mockApiError } from "./mockApiError";

type Store = {
  modules: ParameterModule[];
  mappings: ParameterModuleMapping[];
  driverRegistry: DriverRegistryEntry[];
};

function cloneRegistry(store: Store): ParameterModuleRegistry {
  const modules = store.modules.map((module) => ({ ...module }));
  const subtreeCounts = aggregateSubtreeAttributionCounts(modules);
  return {
    modules: modules.map((module) => {
      const counts = subtreeCounts.get(module.id);
      return {
        ...module,
        parameterCount: counts?.parameterCount ?? 0,
        definitionCount: counts?.definitionCount ?? 0
      };
    }),
    mappings: store.mappings.map((mapping) => ({ ...mapping }))
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
        description: "充电相关业务分类",
        scope: "组织",
        importance: "high",
        kind: "business",
        origin: "curated",
        sourceKey: null,
        effectiveImportance: "high",
        parameterCount: 12,
        definitionCount: 12
      },
{
        id: "mod-battery",
        name: "电池安全",
        parentId: "mod-charging",
        sortOrder: 1,
        description: "电池安全子分类",
        scope: "组织",
        importance: "medium",
        kind: "business",
        origin: "curated",
        sourceKey: null,
        effectiveImportance: "high",
        parameterCount: 4,
        definitionCount: 4
      }
    ],
    mappings: [],
    driverRegistry: []
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
    driverRegistry: seed.driverRegistry
      ? seed.driverRegistry.map((entry) => ({
          ...entry,
          compatibles: [...entry.compatibles],
          parseCoverages: entry.parseCoverages.map((row) => ({ ...row, coverage: { ...row.coverage } }))
        }))
      : base.driverRegistry
  };
  let moduleSeq = 0;

  return {
    async getRegistry() {
      return cloneRegistry(store);
    },

    async createModule(input: CreateParameterModuleInput) {
      if ((input.kind && input.kind !== "business") || input.sourceKey || input.compatibles?.length) {
        throw mockApiError("LEGACY_SURFACE_RETIRED", "Mock mode supports business taxonomy only.");
      }
      moduleSeq += 1;
      const kind = "business";
      const origin = input.origin ?? "curated";
      const importance = input.importance ?? "medium";
      const moduleId = `mod-mock-${moduleSeq}`;
      store.modules.push({
        id: moduleId,
        name: input.name,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder ?? store.modules.length,
        description: input.description ?? "",
        scope: input.scope ?? "",
        importance,
        kind,
        origin,
        sourceKey: input.sourceKey ?? null,
        effectiveImportance: importance,
        parameterCount: 0,
        definitionCount: 0
      });
      return cloneRegistry(store);
    },

    async updateModule(moduleId: string, input: UpdateParameterModuleInput) {
      const target = store.modules.find((module) => module.id === moduleId);
      if (!target) {
        throw mockApiError("NOT_FOUND", `Module not found: ${moduleId}`, { moduleId });
      }
      if (target.kind !== "business" || (input.kind && input.kind !== "business")) {
        throw mockApiError("LEGACY_SURFACE_RETIRED", "Historical module identity is read-only.");
      }
      if (input.name !== undefined) {
        target.name = input.name;
        if (target.origin === "auto") target.origin = "curated";
      }
      if (input.description !== undefined) target.description = input.description;
      if (input.scope !== undefined) target.scope = input.scope;
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
      const target = store.modules.find((module) => module.id === moduleId);
      if (target && target.kind !== "business") {
        throw mockApiError("LEGACY_SURFACE_RETIRED", "Historical module identity is read-only.");
      }
      store.modules = store.modules.filter((module) => module.id !== moduleId);
      store.mappings = store.mappings.filter((mapping) => mapping.moduleId !== moduleId);
      return cloneRegistry(store);
    },

    async listDriverRegistry() {
      return {
        items: store.driverRegistry.map((entry) => ({
          ...entry,
          compatibles: [...entry.compatibles],
          parseCoverages: entry.parseCoverages.map((row) => ({ ...row, coverage: { ...row.coverage } }))
        })),
        total: store.driverRegistry.length
      };
    },
  };
}
