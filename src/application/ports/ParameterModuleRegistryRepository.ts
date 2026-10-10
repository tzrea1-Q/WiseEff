import type {
  ModuleImportance,
  ModuleOrigin,
  ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";

export type CreateParameterModuleInput = {
  name: string;
  parentId?: string | null;
  description?: string;
  scope?: string;
  sortOrder?: number;
  importance?: ModuleImportance;
  kind?: "business" | "driver-group" | "node-type";
  origin?: "curated" | "auto";
  sourceKey?: string | null;
  compatibles?: string[];
};

export type UpdateParameterModuleInput = {
  name?: string;
  description?: string;
  scope?: string;
  parentId?: string | null;
  sortOrder?: number;
  importance?: ModuleImportance;
  kind?: "business" | "node-type";
};

export type DriverNature = "physical-device" | "logical-service";
export type InstanceCardinality = "multiple" | "singleton-per-project";

export type DriverRegistryParseCoverage =
  | { covered: false }
  | {
      covered: true;
      pattern: string;
      driverId: string;
      source: string;
      scope: "platform" | "organization";
      shadowedBy?: Array<{
        pattern: string;
        driverId: string;
        source: string;
        scope: "platform" | "organization";
      }>;
      promoted?: boolean;
    };

export type DriverRegistryEntry = {
  moduleId: string;
  name: string;
  origin: ModuleOrigin;
  businessCategoryId: string | null;
  businessCategoryName: string | null;
  /** Authoritative registration default (D-AG-04); may differ from current tree parent. */
  defaultBusinessCategoryId: string | null;
  compatibles: string[];
  parameterCount: number;
  observed: boolean;
  notYetObserved: boolean;
  /** Read-only historical registration attributes when linked to a driver subject. */
  driverNature: DriverNature | null;
  instanceCardinality: InstanceCardinality | null;
  parseCoverages: Array<{ compatible: string; coverage: DriverRegistryParseCoverage }>;
};

/**
 * Admin-maintained business-module registry (phase 1, additive).
 * Read path feeds the workbench grouping; write path is admin-only governance.
 */
export interface ParameterModuleRegistryRepository {
  getRegistry(): Promise<ParameterModuleRegistry>;
  createModule(input: CreateParameterModuleInput): Promise<ParameterModuleRegistry>;
  updateModule(moduleId: string, input: UpdateParameterModuleInput): Promise<ParameterModuleRegistry>;
  deleteModule(moduleId: string): Promise<ParameterModuleRegistry>;
  listDriverRegistry(): Promise<{ items: DriverRegistryEntry[]; total: number }>;
}
