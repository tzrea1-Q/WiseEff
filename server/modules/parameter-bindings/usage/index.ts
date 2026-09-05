import type pg from "pg";

import { summarizeUsage } from "./query";
import type {
  Result,
  UsageQueryable,
  UsageQueryFailure,
  UsageSummarizeQuery,
  UsageSummaryPage,
} from "./types";

export { USAGE_CURRENT_PROJECTION_SEMANTICS } from "./types";
export type {
  Result,
  UsageProjectScope,
  UsageQueryable,
  UsageQueryAuthScope,
  UsageQueryFailure,
  UsageSummarizeQuery,
  UsageSummary,
  UsageSummaryPage,
} from "./types";

export type UsageQueryClient = pg.Pool | pg.PoolClient | UsageQueryable;

export type UsageQueries = {
  readonly summarize: (
    query: UsageSummarizeQuery,
  ) => Promise<Result<UsageSummaryPage, UsageQueryFailure>>;
};

export function createUsageQueries(client: UsageQueryClient): UsageQueries {
  return {
    summarize: (query) => summarizeUsage(client, query),
  };
}
