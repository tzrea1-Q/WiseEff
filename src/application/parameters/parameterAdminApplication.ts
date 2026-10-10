import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type {
  CreateParameterModuleInput,
  ParameterModuleRegistryRepository,
  UpdateParameterModuleInput,
} from "@/application/ports/ParameterModuleRegistryRepository";
import type {
  ApplyParameterImportBatchInput,
  DtsImportParseResult,
  ParameterImportBatchDto,
  ParameterImportPreviewInput,
  ParseDtsImportInput,
} from "@/application/ports/ParameterRepository";
import type {
  ParameterRuntimeActionFailure,
  ParameterRuntimeVoidResult,
} from "@/application/parameters/parameterRuntime";
import type { ParameterModuleRegistry } from "@/domain/parameter-topology/moduleRegistry";
import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type {
  ConfigRevisionSummary,
  IdentityMappingTask,
  ValidationRun,
} from "@/domain/parameter-topology/types";

/** Import actions the admin facade exposes so panels do not hold separate clients. */
export type ParameterAdminImportActions = {
  createImportPreview(
    input: ParameterImportPreviewInput,
  ): Promise<ParameterImportBatchDto | ParameterRuntimeActionFailure>;
  applyImportBatch(
    input: ApplyParameterImportBatchInput,
  ): Promise<ParameterImportBatchDto | ParameterRuntimeVoidResult>;
  parseDtsImport(input: ParseDtsImportInput): Promise<DtsImportParseResult>;
  refresh?(): Promise<unknown>;
};

/**
 * Single application facade for the parameter admin surface.
 * Panels depend on this seam only — never on multiple HTTP/mock clients.
 */
export type ParameterAdminApplication = {
  getModuleRegistry(): Promise<ParameterModuleRegistry>;
  createModule(
    input: CreateParameterModuleInput,
  ): Promise<ParameterModuleRegistry>;
  updateModule(
    moduleId: string,
    input: UpdateParameterModuleInput,
  ): Promise<ParameterModuleRegistry>;
  deleteModule(moduleId: string): Promise<ParameterModuleRegistry>;
  asModuleRegistryRepository(): ParameterModuleRegistryRepository;

  createImportPreview(
    input: ParameterImportPreviewInput,
  ): Promise<ParameterImportBatchDto | ParameterRuntimeActionFailure>;
  applyImportBatch(
    input: ApplyParameterImportBatchInput,
  ): Promise<ParameterImportBatchDto | ParameterRuntimeVoidResult>;
  parseDtsImport(input: ParseDtsImportInput): Promise<DtsImportParseResult>;

  listMappingTasks(projectId?: string): Promise<IdentityMappingTask[]>;
  listConfigRevisions(
    projectId: string,
    configSetId: string,
  ): Promise<ConfigRevisionSummary[]>;
  validateRevision(
    projectId: string,
    revisionId: string,
  ): Promise<ValidationRun>;
  listBindings(
    projectId: string,
    revisionId: string,
  ): ReturnType<ParameterTopologyRepository["listBindings"]>;
  createBindingDraft(
    projectId: string,
    bindingId: string,
    input: Parameters<ParameterTopologyRepository["createBindingDraft"]>[2],
  ): ReturnType<ParameterTopologyRepository["createBindingDraft"]>;

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
  parameterFiles,
}: CreateParameterAdminApplicationOptions): ParameterAdminApplication {
  const asModuleRegistryRepository = (): ParameterModuleRegistryRepository => ({
    getRegistry: () => moduleRegistry.getRegistry(),
    createModule: (input) => moduleRegistry.createModule(input),
    updateModule: (moduleId, input) =>
      moduleRegistry.updateModule(moduleId, input),
    deleteModule: (moduleId) => moduleRegistry.deleteModule(moduleId),
    listDriverRegistry: () => moduleRegistry.listDriverRegistry(),
  });

  return {
    getModuleRegistry() {
      return moduleRegistry.getRegistry();
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
    listConfigRevisions(projectId, configSetId) {
      return topology.listConfigRevisions(projectId, configSetId);
    },
    validateRevision(projectId, revisionId) {
      return topology.validateRevision(projectId, revisionId);
    },
    listBindings(projectId, revisionId) {
      return topology.listBindings(projectId, revisionId);
    },
    createBindingDraft(projectId, bindingId, input) {
      return topology.createBindingDraft(projectId, bindingId, input);
    },

    asDtsStructuredRepository() {
      return dtsStructured ?? null;
    },
    asParameterFileRepository() {
      return parameterFiles ?? null;
    },
  };
}
