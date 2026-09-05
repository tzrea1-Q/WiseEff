import type {
  ParameterDefinitionId,
  Result as ContractResult,
} from "../../parameter-catalog-contract/index";

export type Result<T, E> = ContractResult<T, E>;

export type UsageQueryable = {
  query<T extends import("pg").QueryResultRow = import("pg").QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<import("pg").QueryResult<T>>;
};

export type UsageQueryAuthScope = {
  readonly organizationId: string;
  readonly principalId: string;
};

export const USAGE_CURRENT_PROJECTION_SEMANTICS = {
  kind: "current-organization-projection",
  catalogReleasePinned: false,
  projectCountDedupKey: "project_parameter_bindings.project_id",
  currentValueCount:
    "project_parameter_bindings.current_value_id pointing at a non-placeholder Binding current-value row",
  policyCount:
    "0 until a Binding-owned Policy public-read aggregate keyed by ParameterDefinitionId exists; this query does not join public.parameter_policy_targets, review, or alias tables",
  note: "Usage summaries are request-time organization aggregates and are not a historical Catalog-release snapshot.",
} as const;

export type UsageSummary = {
  readonly definitionId: ParameterDefinitionId;
  readonly policyCount: number;
  readonly projectCount: number;
  readonly currentValueCount: number;
};

export type UsageSummaryPage = {
  readonly semantics: typeof USAGE_CURRENT_PROJECTION_SEMANTICS;
  readonly summaries: readonly UsageSummary[];
};

export type UsageProjectScope =
  | { readonly kind: "all" }
  | { readonly kind: "only"; readonly ids: readonly string[] };

export type UsageSummarizeQuery = {
  readonly organizationId: string;
  readonly definitionIds: readonly ParameterDefinitionId[];
  readonly projectScope: UsageProjectScope;
  readonly authScope: UsageQueryAuthScope;
};

export type UsageQueryFailure =
  | { readonly kind: "invalid-query"; readonly reason: string }
  | { readonly kind: "not-found"; readonly resource: "organization" }
  | { readonly kind: "timeout"; readonly operation: string }
  | { readonly kind: "dependency-failure"; readonly operation: string }
  | { readonly kind: "query-unavailable"; readonly operation: string };
