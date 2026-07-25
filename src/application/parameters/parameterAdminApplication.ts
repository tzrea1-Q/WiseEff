import type {
  ActivateParameterSpecInput,
  ParameterTopologyRepository,
  ResolveSpecReviewInput
} from "@/application/ports/ParameterTopologyRepository";
import type {
  CreateModuleMappingInput,
  CreateParameterModuleInput,
  ModuleDiscoveryHints,
  ParameterModuleRegistryRepository,
  RecomputeBindingModulesResult,
  UpdateParameterModuleInput
} from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterModuleRegistry } from "@/domain/parameter-topology/moduleRegistry";
import type {
  ParameterSpecDetail,
  ParameterSpecSummary,
  SpecQuery,
  SpecReviewTaskListResult,
  SpecReviewTaskQuery
} from "@/domain/parameter-topology/types";

/**
 * Single application facade for the parameter admin surface.
 * Panels depend on this seam only — never on multiple HTTP/mock clients.
 */
export type ParameterAdminApplication = {
  listSpecs(query?: SpecQuery): Promise<ParameterSpecSummary[]>;
  getSpec(specId: string): Promise<ParameterSpecDetail>;
  listSpecReviewTasks(query?: SpecReviewTaskQuery): Promise<SpecReviewTaskListResult>;
  resolveSpecReviewTask(taskId: string, input: ResolveSpecReviewInput): Promise<void>;
  activateParameterSpec(specId: string, input: ActivateParameterSpecInput): Promise<ParameterSpecDetail>;

  getModuleRegistry(): Promise<ParameterModuleRegistry>;
  getModuleDiscoveryHints(): Promise<ModuleDiscoveryHints>;
  createModule(input: CreateParameterModuleInput): Promise<ParameterModuleRegistry>;
  updateModule(moduleId: string, input: UpdateParameterModuleInput): Promise<ParameterModuleRegistry>;
  deleteModule(moduleId: string): Promise<ParameterModuleRegistry>;
  createModuleMapping(input: CreateModuleMappingInput): Promise<ParameterModuleRegistry>;
  deleteModuleMapping(mappingId: string): Promise<ParameterModuleRegistry>;
  recomputeBindingModules(input?: { projectId?: string }): Promise<RecomputeBindingModulesResult>;

  /** Port-shaped view of the module registry for panels that already accept the repository. */
  asModuleRegistryRepository(): ParameterModuleRegistryRepository;
};

export type CreateParameterAdminApplicationOptions = {
  topology: ParameterTopologyRepository;
  moduleRegistry: ParameterModuleRegistryRepository;
};

export function createParameterAdminApplication({
  topology,
  moduleRegistry
}: CreateParameterAdminApplicationOptions): ParameterAdminApplication {
  const asModuleRegistryRepository = (): ParameterModuleRegistryRepository => ({
    getRegistry: () => moduleRegistry.getRegistry(),
    getDiscoveryHints: () => moduleRegistry.getDiscoveryHints(),
    createModule: (input) => moduleRegistry.createModule(input),
    updateModule: (moduleId, input) => moduleRegistry.updateModule(moduleId, input),
    deleteModule: (moduleId) => moduleRegistry.deleteModule(moduleId),
    createMapping: (input) => moduleRegistry.createMapping(input),
    deleteMapping: (mappingId) => moduleRegistry.deleteMapping(mappingId),
    recomputeBindings: (input) => moduleRegistry.recomputeBindings(input)
  });

  return {
    listSpecs(query = {}) {
      return topology.listSpecs(query);
    },
    getSpec(specId) {
      return topology.getSpec(specId);
    },
    listSpecReviewTasks(query = {}) {
      return topology.listSpecReviewTasks(query);
    },
    resolveSpecReviewTask(taskId, input) {
      return topology.resolveSpecReviewTask(taskId, input);
    },
    activateParameterSpec(specId, input) {
      return topology.activateParameterSpec(specId, input);
    },

    getModuleRegistry() {
      return moduleRegistry.getRegistry();
    },
    getModuleDiscoveryHints() {
      return moduleRegistry.getDiscoveryHints();
    },
    createModule(input) {
      return moduleRegistry.createModule(input);
    },
    updateModule(moduleId, input) {
      return moduleRegistry.updateModule(moduleId, input);
    },
    deleteModule(moduleId) {
      return moduleRegistry.deleteModule(moduleId);
    },
    createModuleMapping(input) {
      return moduleRegistry.createMapping(input);
    },
    deleteModuleMapping(mappingId) {
      return moduleRegistry.deleteMapping(mappingId);
    },
    recomputeBindingModules(input) {
      return moduleRegistry.recomputeBindings(input);
    },
    asModuleRegistryRepository
  };
}
