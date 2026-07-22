import type {
  BindingPolicyState,
  BindingSchemaState,
  DtsValue,
  EffectiveTopologyEffect,
  TopologyView
} from "./types";
import type { ModuleImportance } from "./moduleRegistry";

export type DtsWorkbenchGovernanceState = "valid" | "attention" | "blocked";

/**
 * Presentation model for the mature parameter workbench.
 * Stable identity stays in the binding/spec fields; topology paths are display context only.
 */
export type DtsParameterWorkbenchRow = {
  bindingId: string;
  parameterSpecId: string;
  parameterSpecVersionId: string;
  logicalNodeId: string | null;
  propertyKey: string;
  driverModule: string | null;
  compatible: string | null;
  instanceName: string | null;
  /** Business module the binding is grouped under (admin mapping or driver fallback). */
  moduleId: string;
  moduleName: string;
  /** Root→leaf business module names from registry `parentId` (fallback: `[moduleName]`). */
  modulePath: string[];
  /** Importance inherited from the assigned module. */
  importance: ModuleImportance;
  /** Admin sort order for the assigned module (fallback modules sort last). */
  moduleSortOrder: number;
  /** True when the module came from an admin mapping rather than driver fallback. */
  moduleMapped: boolean;
  unitAddress: string | null;
  topologyPath: string | null;
  topologyNodeId: string | null;
  sourceOccurrenceId: string | null;
  sourceFileName: string | null;
  sourceNodePath: string | null;
  sourceLine: number | null;
  rawValue: string;
  effectiveValue: DtsValue;
  valueShapeSummary: string;
  schemaState: BindingSchemaState;
  policyState: BindingPolicyState;
  mappingOpen: boolean;
  governanceState: DtsWorkbenchGovernanceState;
  effects: EffectiveTopologyEffect[];
  searchText: string;
  view: TopologyView;
};

/** @deprecated Prefer the explicit DtsParameterWorkbenchRow contract name. */
export type DtsWorkbenchRow = DtsParameterWorkbenchRow;
