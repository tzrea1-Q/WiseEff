import type {
  CreateModuleMappingInput,
  CreateParameterModuleInput,
  ParameterModuleRegistryRepository,
  RecomputeBindingModulesResult,
  UpdateParameterModuleInput
} from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterModuleRegistry } from "@/domain/parameter-topology/moduleRegistry";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";

type ApiClient = ReturnType<typeof createApiClient>;
type RegistryEnvelope = { item: ParameterModuleRegistry };

const REGISTRY_BASE = "/api/v2/parameter-modules";
const V1_MODULES = "/api/v1/parameter-modules";

function registryFromDto(dto: ParameterModuleRegistry): ParameterModuleRegistry {
  return {
    modules: dto.modules.map((module) => ({
      id: module.id,
      name: module.name,
      parentId: module.parentId ?? null,
      sortOrder: module.sortOrder ?? 0,
      importance: module.importance ?? "medium"
    })),
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
    async createMapping(input: CreateModuleMappingInput) {
      const response = await apiClient.post<RegistryEnvelope>(`${REGISTRY_BASE}/mappings`, input);
      return registryFromDto(response.item);
    },
    async deleteMapping(mappingId: string) {
      const response = await apiClient.delete<RegistryEnvelope>(
        `${REGISTRY_BASE}/mappings/${encodeURIComponent(mappingId)}`
      );
      return registryFromDto(response.item);
    },
    async recomputeBindings(input?: { projectId?: string }) {
      return apiClient.post<RecomputeBindingModulesResult>(
        `${REGISTRY_BASE}/recompute-bindings`,
        input?.projectId ? { projectId: input.projectId } : {}
      );
    }
  };
}

export type ParameterModuleRegistryClient = ReturnType<
  typeof createHttpParameterModuleRegistryRepository
>;
