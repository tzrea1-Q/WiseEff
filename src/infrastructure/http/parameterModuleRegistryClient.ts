import type {
  CreateModuleMappingInput,
  CreateParameterModuleInput,
  MappingApplyPreview,
  MappingMutationResult,
  ModuleDiscoveryHints,
  ParameterModuleRegistryRepository,
  RecomputeBindingModulesResult,
  UpdateParameterModuleInput
} from "@/application/ports/ParameterModuleRegistryRepository";
import type {
  ModuleImportance,
  ModuleKind,
  ModuleOrigin,
  ParameterModule,
  ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";

type ApiClient = ReturnType<typeof createApiClient>;

type ModuleDto = {
  id: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
  importance?: ModuleImportance;
  kind?: ModuleKind;
  origin?: ModuleOrigin;
  sourceKey?: string | null;
  effectiveImportance?: ModuleImportance;
  parameterCount?: number;
};

type MappingDto = {
  id: string;
  moduleId: string;
  matchKind: ParameterModuleRegistry["mappings"][number]["matchKind"];
  matchValue: string;
  priority?: number;
};

type RegistryDto = {
  modules: ModuleDto[];
  mappings: MappingDto[];
};

type RegistryEnvelope = { item: RegistryDto };
type MappingMutationEnvelope = { item: RegistryDto; apply: MappingApplyPreview };
type PreviewEnvelope = { item: MappingApplyPreview };
type DiscoveryEnvelope = { item: ModuleDiscoveryHints };

const REGISTRY_BASE = "/api/v2/parameter-modules";
const V1_MODULES = "/api/v1/parameter-modules";

function mapModule(module: ModuleDto): ParameterModule {
  const importance = module.importance ?? "medium";
  return {
    id: module.id,
    name: module.name,
    parentId: module.parentId ?? null,
    sortOrder: module.sortOrder ?? 0,
    importance,
    kind: module.kind ?? "business",
    origin: module.origin ?? "curated",
    sourceKey: module.sourceKey ?? null,
    effectiveImportance: module.effectiveImportance ?? importance,
    parameterCount: module.parameterCount ?? 0
  };
}

function registryFromDto(dto: RegistryDto): ParameterModuleRegistry {
  return {
    modules: dto.modules.map(mapModule),
    mappings: dto.mappings.map((mapping) => ({
      id: mapping.id,
      moduleId: mapping.moduleId,
      matchKind: mapping.matchKind,
      matchValue: mapping.matchValue,
      priority: mapping.priority ?? 0
    }))
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

/**
 * Module CRUD goes through v1 `/api/v1/parameter-modules` (shared taxonomy tree).
 * Registry read + mappings CRUD stay on additive v2 endpoints.
 */
export function createHttpParameterModuleRegistryRepository(
  apiClient: ApiClient = createDefaultApiClient()
): ParameterModuleRegistryRepository {
  const getRegistry = async () => {
    const response = await apiClient.get<RegistryEnvelope>(REGISTRY_BASE);
    return registryFromDto(response.item);
  };

  return {
    getRegistry,

    async getDiscoveryHints() {
      const response = await apiClient.get<DiscoveryEnvelope>(`${REGISTRY_BASE}/discovery-hints`);
      return {
        compatibles: response.item.compatibles.map((hint) => ({
          compatible: hint.compatible,
          bindingCount: hint.bindingCount,
          projectCount: hint.projectCount ?? 0,
          suggestedGroupName: hint.suggestedGroupName ?? hint.compatible
        })),
        total: response.item.total ?? response.item.compatibles.length
      };
    },

    async dismissCompatible(input) {
      const response = await apiClient.post<DiscoveryEnvelope>(
        `${REGISTRY_BASE}/discovery-hints/dismissals`,
        input
      );
      return {
        compatibles: response.item.compatibles.map((hint) => ({
          compatible: hint.compatible,
          bindingCount: hint.bindingCount,
          projectCount: hint.projectCount ?? 0,
          suggestedGroupName: hint.suggestedGroupName ?? hint.compatible
        })),
        total: response.item.total ?? response.item.compatibles.length
      };
    },

    async restoreDismissedCompatible(compatible: string) {
      const response = await apiClient.delete<DiscoveryEnvelope>(
        `${REGISTRY_BASE}/discovery-hints/dismissals/${encodeURIComponent(compatible)}`
      );
      return {
        compatibles: response.item.compatibles.map((hint) => ({
          compatible: hint.compatible,
          bindingCount: hint.bindingCount,
          projectCount: hint.projectCount ?? 0,
          suggestedGroupName: hint.suggestedGroupName ?? hint.compatible
        })),
        total: response.item.total ?? response.item.compatibles.length
      };
    },

    async createModule(input: CreateParameterModuleInput) {
      await apiClient.post(V1_MODULES, {
        name: input.name,
        parentId: input.parentId,
        sortOrder: input.sortOrder,
        importance: input.importance
      });
      return getRegistry();
    },

    async updateModule(moduleId: string, input: UpdateParameterModuleInput) {
      if (input.parentId !== undefined) {
        await apiClient.post(`${V1_MODULES}/${encodeURIComponent(moduleId)}/move`, {
          parentId: input.parentId
        });
      }
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
      if (input.importance !== undefined) patch.importance = input.importance;
      if (Object.keys(patch).length > 0) {
        await apiClient.patch(`${V1_MODULES}/${encodeURIComponent(moduleId)}`, patch);
      }
      return getRegistry();
    },

    async deleteModule(moduleId: string) {
      await apiClient.delete(`${V1_MODULES}/${encodeURIComponent(moduleId)}`);
      return getRegistry();
    },

    async previewMapping(input: CreateModuleMappingInput) {
      const response = await apiClient.post<PreviewEnvelope>(
        `${REGISTRY_BASE}/mappings/preview`,
        input
      );
      return response.item;
    },

    async createMapping(input: CreateModuleMappingInput): Promise<MappingMutationResult> {
      const response = await apiClient.post<MappingMutationEnvelope>(
        `${REGISTRY_BASE}/mappings`,
        input
      );
      return {
        registry: registryFromDto(response.item),
        apply: response.apply ?? emptyPreview(input.moduleId)
      };
    },

    async deleteMapping(mappingId: string): Promise<MappingMutationResult> {
      const response = await apiClient.delete<MappingMutationEnvelope>(
        `${REGISTRY_BASE}/mappings/${encodeURIComponent(mappingId)}`
      );
      return {
        registry: registryFromDto(response.item),
        apply: response.apply ?? emptyPreview(null)
      };
    },

    async recomputeBindings(input?: { projectId?: string; dryRun?: boolean }) {
      const body: Record<string, unknown> = {};
      if (input?.projectId) body.projectId = input.projectId;
      if (input?.dryRun) body.dryRun = true;
      return apiClient.post<RecomputeBindingModulesResult>(
        `${REGISTRY_BASE}/recompute-bindings`,
        body
      );
    }
  };
}

export type ParameterModuleRegistryClient = ReturnType<
  typeof createHttpParameterModuleRegistryRepository
>;
