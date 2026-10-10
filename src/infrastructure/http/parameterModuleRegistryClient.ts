import type {
  CreateParameterModuleInput,
  DriverRegistryEntry,
  ParameterModuleRegistryRepository,
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
  description?: string;
  scope?: string;
  importance?: ModuleImportance;
  kind?: ModuleKind;
  origin?: ModuleOrigin;
  sourceKey?: string | null;
  effectiveImportance?: ModuleImportance;
  parameterCount?: number;
  definitionCount?: number;
  attributionSubjectId?: string | null;
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
type DriverRegistryListResponse = { items: DriverRegistryEntry[]; total: number };

const REGISTRY_BASE = "/api/v2/parameter-modules";
const V1_MODULES = "/api/v1/parameter-modules";

function mapModule(module: ModuleDto): ParameterModule {
  const importance = module.importance ?? "medium";
  return {
    id: module.id,
    name: module.name,
    parentId: module.parentId ?? null,
    sortOrder: module.sortOrder ?? 0,
    description: module.description ?? "",
    scope: module.scope ?? "",
    importance,
    kind: module.kind ?? "business",
    origin: module.origin ?? "curated",
    sourceKey: module.sourceKey ?? null,
    effectiveImportance: module.effectiveImportance ?? importance,
    parameterCount: module.parameterCount ?? 0,
    definitionCount: module.definitionCount ?? 0,
    attributionSubjectId: module.attributionSubjectId ?? null
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

/**
 * Module CRUD goes through v1 `/api/v1/parameter-modules` (shared taxonomy tree).
 * Registry and historical driver reads stay on additive v2 endpoints.
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

    async createModule(input: CreateParameterModuleInput) {
      await apiClient.post(V1_MODULES, {
        name: input.name,
        parentId: input.parentId,
        description: input.description,
        scope: input.scope,
        sortOrder: input.sortOrder,
        importance: input.importance,
        kind: input.kind,
        origin: input.origin,
        sourceKey: input.sourceKey
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
      if (input.description !== undefined) patch.description = input.description;
      if (input.scope !== undefined) patch.scope = input.scope;
      if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
      if (input.importance !== undefined) patch.importance = input.importance;
      if (input.kind !== undefined) patch.kind = input.kind;
      if (Object.keys(patch).length > 0) {
        await apiClient.patch(`${V1_MODULES}/${encodeURIComponent(moduleId)}`, patch);
      }
      return getRegistry();
    },

    async deleteModule(moduleId: string) {
      await apiClient.delete(`${V1_MODULES}/${encodeURIComponent(moduleId)}`);
      return getRegistry();
    },

    async listDriverRegistry() {
      return apiClient.get<DriverRegistryListResponse>(`${REGISTRY_BASE}/driver-registry`);
    },
  };
}

export type ParameterModuleRegistryClient = ReturnType<
  typeof createHttpParameterModuleRegistryRepository
>;
