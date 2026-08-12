import type { LogDomainKnowledgeSearchResult } from "../../../knowledge/logDomainRetrieval";
import type { ParseResult } from "../../parser";
import type { PrefilterFindings } from "../../prefilter";

/**
 * Execution context the agent-loop kernel hands to its read-only tools (ADR-0022:
 * plain internal functions of the worker, never ToolRegistry members). The parsed
 * log and prefilter findings are always present; the two backends that need the
 * database are optional closures the kernel binds with the organization scope
 * already applied — a tool can never widen the query beyond what the worker
 * snapshot authorized.
 */
export type LogAnalysisToolContext = {
  parsed: Extract<ParseResult, { ok: true }>;
  prefilter: PrefilterFindings;
  /** Bound to the log's organization + domain link set; absent = retrieval unavailable (offline eval). */
  searchDomainKnowledge?: (query: string) => Promise<LogDomainKnowledgeSearchResult>;
  /** Bound to the log's organization + relatedParameterId; absent = no related parameter or no database. */
  loadRelatedParameterContext?: () => Promise<RelatedParameterContext | null>;
};

/** Read-only summary of the parameter a log was uploaded against, plus recent value changes. */
export type RelatedParameterContext = {
  parameterId: string;
  name: string;
  description?: string;
  unit?: string;
  projectId: string;
  currentValue?: string;
  schemaDefault?: string;
  policyTarget?: string;
  recentChanges: Array<{
    value?: string;
    changedAt: string;
  }>;
};

export type LogAnalysisToolSuccess = { ok: true; result: unknown };
export type LogAnalysisToolFailure = { ok: false; error: string };
export type LogAnalysisToolOutcome = LogAnalysisToolSuccess | LogAnalysisToolFailure;
