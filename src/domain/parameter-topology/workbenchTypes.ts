import type {
  BindingPolicyState,
  BindingSchemaState,
  DtsValue,
  EffectiveTopologyEffect,
  TopologyView
} from "./types";

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
