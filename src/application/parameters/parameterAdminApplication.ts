import type {
  ActivateParameterSpecInput,
  CreateParameterSpecInput,
  DeprecateParameterSpecInput,
  ParameterTopologyRepository,
  ReopenMappingInput,
  ResolveMappingInput,
  ResolveSpecReviewInput,
  RestoreParameterSpecInput,
  UpdateParameterSpecInput
} from "@/application/ports/ParameterTopologyRepository";
import type {
  CreateModuleMappingInput,
  CreateParameterModuleInput,
  MappingMutationResult,
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
import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type {
  IdentityMappingTask,
  ParameterSpecDetail,
  ParameterSpecSummary,
  ParameterSpecCutoverSummary,
  SpecQuery,
  SpecReviewTaskListResult,
  SpecReviewTaskQuery,
  ValidationRun
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
  createParameterSpec(input: CreateParameterSpecInput): Promise<ParameterSpecDetail>;
  listSpecReviewTasks(query?: SpecReviewTaskQuery): Promise<SpecReviewTaskListResult>;
  resolveSpecReviewTask(taskId: string, input: ResolveSpecReviewInput): Promise<void>;
  activateParameterSpec(specId: string, input: ActivateParameterSpecInput): Promise<ParameterSpecDetail>;
  updateParameterSpec(specId: string, input: UpdateParameterSpecInput): Promise<ParameterSpecDetail>;
  deprecateParameterSpec(specId: string, input: DeprecateParameterSpecInput): Promise<ParameterSpecDetail>;
  restoreParameterSpec(specId: string, input: RestoreParameterSpecInput): Promise<ParameterSpecDetail>;
  getSpecVersionCutoverImpact(specId: string): Promise<ParameterSpecCutoverSummary>;
  prepareSpecVersionCutover(
    specId: string,
    input?: { reason?: string }
  ): Promise<ParameterSpecDetail>;
  finalizeSpecVersionCutover(specId: string, input: { reason: string }): Promise<ParameterSpecDetail>;

  getModuleRegistry(): Promise<ParameterModuleRegistry>;
  getModuleDiscoveryHints(): Promise<ModuleDiscoveryHints>;
  createModule(input: CreateParameterModuleInput): Promise<ParameterModuleRegistry>;
  updateModule(moduleId: string, input: UpdateParameterModuleInput): Promise<ParameterModuleRegistry>;
  deleteModule(moduleId: string): Promise<ParameterModuleRegistry>;
  createModuleMapping(input: CreateModuleMappingInput): Promise<MappingMutationResult>;
  deleteModuleMapping(mappingId: string): Promise<MappingMutationResult>;
  recomputeBindingModules(input?: { projectId?: string }): Promise<RecomputeBindingModulesResult>;
  asModuleRegistryRepository(): ParameterModuleRegistryRepository;

  createImportPreview(
    input: ParameterImportPreviewInput
  ): Promise<ParameterImportBatchDto | ParameterRuntimeActionFailure>;
  applyImportBatch(input: ApplyParameterImportBatchInput): Promise<ParameterRuntimeVoidResult>;
  parseDtsImport(input: ParseDtsImportInput): Promise<DtsImportParseResult>;

  listMappingTasks(projectId?: string): Promise<IdentityMappingTask[]>;
  resolveMapping(taskId: string, input: ResolveMappingInput): Promise<void>;
  reopenMapping(taskId: string, input: ReopenMappingInput): Promise<void>;
  validateRevision(projectId: string, revisionId: string): Promise<ValidationRun>;

  asDtsStructuredRepository(): DtsStructuredRepository | null;
  asParameterFileRepository(): ParameterFileRepository | null;
};

export type CreateParameterAdminApplicationOptions = {
  topology: ParameterTopologyRepository;
  moduleRegistry: ParameterModuleRegistryRepository;
  importActions?: ParameterAdminImportActions;
  dtsStructured?: DtsStructuredRepository;
  parameterFiles?: ParameterFileRepository;
};

function missingImport(action: string): never {
  throw new Error(`Parameter admin import action unavailable: ${action}`);
}

export function createParameterAdminApplication({
  topology,
  moduleRegistry,
  importActions,
  dtsStructured,
  parameterFiles
}: CreateParameterAdminApplicationOptions): ParameterAdminApplication {
  const asModuleRegistryRepository = (): ParameterModuleRegistryRepository => ({
    getRegistry: () => moduleRegistry.getRegistry(),
    getDiscoveryHints: () => moduleRegistry.getDiscoveryHints(),
    dismissCompatible: (input) => moduleRegistry.dismissCompatible(input),
    restoreDismissedCompatible: (compatible) =>
      moduleRegistry.restoreDismissedCompatible(compatible),
    createModule: (input) => moduleRegistry.createModule(input),
    updateModule: (moduleId, input) => moduleRegistry.updateModule(moduleId, input),
    deleteModule: (moduleId) => moduleRegistry.deleteModule(moduleId),
    previewMapping: (input) => moduleRegistry.previewMapping(input),
    createMapping: (input) => moduleRegistry.createMapping(input),
    deleteMapping: (mappingId) => moduleRegistry.deleteMapping(mappingId),
    recomputeBindings: (input) => moduleRegistry.recomputeBindings(input),
    listDriverRegistry: () => moduleRegistry.listDriverRegistry(),
    registerOrClaimDriver: (input) => moduleRegistry.registerOrClaimDriver(input),
    createOrganizationDriverSchema: (input) => moduleRegistry.createOrganizationDriverSchema(input),
    listOrganizationDriverSchemas: () => moduleRegistry.listOrganizationDriverSchemas(),
    updateOrganizationDriverSchema: (schemaId, input) =>
      moduleRegistry.updateOrganizationDriverSchema(schemaId, input),
    activateOrganizationDriverSchema: (schemaId) =>
      moduleRegistry.activateOrganizationDriverSchema(schemaId),
    previewOrganizationDriverSchemaDeprecation: (schemaId) =>
      moduleRegistry.previewOrganizationDriverSchemaDeprecation?.(schemaId) ??
      Promise.reject(new Error("Overlay deprecation preview is unavailable.")),
    deprecateOrganizationDriverSchema: (schemaId, input) =>
      moduleRegistry.deprecateOrganizationDriverSchema?.(schemaId, input) ??
      Promise.reject(new Error("Overlay deprecation is unavailable."))
  });

  return {
    listSpecs(query = {}) {
      return topology.listSpecs(query);
    },
    getSpec(specId) {
      return topology.getSpec(specId);
    },
    createParameterSpec(input) {
      return topology.createParameterSpec(input);
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
    updateParameterSpec(specId, input) {
      return topology.updateParameterSpec(specId, input);
    },
    deprecateParameterSpec(specId, input) {
      return topology.deprecateParameterSpec(specId, input);
    },
    restoreParameterSpec(specId, input) {
      return topology.restoreParameterSpec(specId, input);
    },
    getSpecVersionCutoverImpact(specId) {
      return topology.getSpecVersionCutoverImpact(specId);
    },
    prepareSpecVersionCutover(specId, input = {}) {
      return topology.prepareSpecVersionCutover(specId, input);
    },
    finalizeSpecVersionCutover(specId, input) {
      return topology.finalizeSpecVersionCutover(specId, input);
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
    },

    listMappingTasks(projectId) {
      return topology.listMappingTasks(projectId);
    },
    resolveMapping(taskId, input) {
      return topology.resolveMapping(taskId, input);
    },
    reopenMapping(taskId, input) {
      if (!topology.reopenMapping) {
        throw new Error("Identity mapping reopen is unavailable in this runtime.");
      }
      return topology.reopenMapping(taskId, input);
    },
    validateRevision(projectId, revisionId) {
      return topology.validateRevision(projectId, revisionId);
    },

    asDtsStructuredRepository() {
      return dtsStructured ?? null;
    },
    asParameterFileRepository() {
      return parameterFiles ?? null;
    }
  };
}
