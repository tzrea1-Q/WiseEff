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
import type {
  ApplyParameterImportBatchInput,
  DtsImportParseResult,
  ParameterImportBatchDto,
  ParameterImportPreviewInput,
  ParseDtsImportInput
} from "@/application/ports/ParameterRepository";
import type {
  ParameterRuntimeActionFailure,
  ParameterRuntimeVoidResult
} from "@/application/parameters/parameterRuntime";
import type { ParameterModuleRegistry } from "@/domain/parameter-topology/moduleRegistry";
import type {
  ParameterSpecDetail,
  ParameterSpecSummary,
  SpecQuery,
  SpecReviewTaskListResult,
  SpecReviewTaskQuery
} from "@/domain/parameter-topology/types";

/** Import actions the admin facade exposes so panels do not hold separate clients. */
export type ParameterAdminImportActions = {
  createImportPreview(
    input: ParameterImportPreviewInput
  ): Promise<ParameterImportBatchDto | ParameterRuntimeActionFailure>;
  applyImportBatch(input: ApplyParameterImportBatchInput): Promise<ParameterRuntimeVoidResult>;
  parseDtsImport(input: ParseDtsImportInput): Promise<DtsImportParseResult>;
  refresh?(): Promise<unknown>;
};

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
  asModuleRegistryRepository(): ParameterModuleRegistryRepository;

  createImportPreview(
    input: ParameterImportPreviewInput
  ): Promise<ParameterImportBatchDto | ParameterRuntimeActionFailure>;
  applyImportBatch(input: ApplyParameterImportBatchInput): Promise<ParameterRuntimeVoidResult>;
  parseDtsImport(input: ParseDtsImportInput): Promise<DtsImportParseResult>;
};

export type CreateParameterAdminApplicationOptions = {
  topology: ParameterTopologyRepository;
  moduleRegistry: ParameterModuleRegistryRepository;
  importActions?: ParameterAdminImportActions;
};

function missingImport(action: string): never {
  throw new Error(`Parameter admin import action unavailable: ${action}`);
}

export function createParameterAdminApplication({
  topology,
  moduleRegistry,
  importActions
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
    asModuleRegistryRepository,

    createImportPreview(input) {
      if (!importActions) {
        return missingImport("createImportPreview");
      }
      return importActions.createImportPreview(input);
    },
    applyImportBatch(input) {
      if (!importActions) {
        return missingImport("applyImportBatch");
      }
      return importActions.applyImportBatch(input);
    },
    parseDtsImport(input) {
      if (!importActions) {
        return missingImport("parseDtsImport");
      }
      return importActions.parseDtsImport(input);
    }
  };
}
