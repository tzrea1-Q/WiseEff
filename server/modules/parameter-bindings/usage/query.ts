import pg from "pg";

import { ParameterDefinitionId } from "../../parameter-catalog-contract/index";
import { IDENTITY_PLACEHOLDER_SOURCE } from "../values/repositories";

import type {
  Result,
  UsageQueryable,
  UsageQueryFailure,
  UsageSummarizeQuery,
  UsageSummary,
  UsageSummaryPage,
} from "./types";
import { USAGE_CURRENT_PROJECTION_SEMANTICS } from "./types";

const isUsableToken = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.trim() === value &&
  !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

const fail = (error: UsageQueryFailure): Result<never, UsageQueryFailure> => ({
  ok: false,
  error,
});

const asQueryable = (client: pg.Pool | pg.PoolClient | UsageQueryable): UsageQueryable => ({
  query: (text, values) => (client as UsageQueryable).query(text, values as unknown[] | undefined),
});

const isPool = (source: pg.Pool | pg.PoolClient | UsageQueryable): source is pg.Pool =>
  typeof (source as pg.Pool).connect === "function" &&
  typeof (source as pg.Pool).end === "function" &&
  typeof (source as pg.PoolClient).release !== "function";

const withReadTransaction = async <T>(
  source: pg.Pool | pg.PoolClient | UsageQueryable,
  work: (client: UsageQueryable) => Promise<T>,
): Promise<T> => {
  if (!isPool(source)) {
    return work(asQueryable(source));
  }
  const client = await source.connect();
  try {
    await client.query("begin read only");
    const result = await work(asQueryable(client));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

const connectionCodes = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01", "08006", "08001"]);

const mapQueryError = (error: unknown, operation: string): UsageQueryFailure => {
  const code =
    error instanceof pg.DatabaseError
      ? error.code ?? ""
      : error !== null && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
  if (code === "57014" || code === "55P03") {
    return { kind: "timeout", operation };
  }
  if (connectionCodes.has(code)) {
    return { kind: "dependency-failure", operation };
  }
  return { kind: "query-unavailable", operation };
};

type UsageRow = {
  definition_id: string;
  project_count: string;
  current_value_count: string;
};

export const summarizeUsage = async (
  source: pg.Pool | pg.PoolClient | UsageQueryable,
  query: UsageSummarizeQuery,
): Promise<Result<UsageSummaryPage, UsageQueryFailure>> => {
  if (!isUsableToken(query.organizationId)) {
    return fail({ kind: "invalid-query", reason: "organizationId" });
  }
  if (
    !isUsableToken(query.authScope.organizationId) ||
    !isUsableToken(query.authScope.principalId)
  ) {
    return fail({ kind: "invalid-query", reason: "authScope" });
  }
  if (query.organizationId !== query.authScope.organizationId) {
    return fail({ kind: "not-found", resource: "organization" });
  }
  if (query.projectScope.kind === "only" && query.projectScope.ids.some((id) => !isUsableToken(id))) {
    return fail({ kind: "invalid-query", reason: "projectScope" });
  }

  const valuesRelation = ["project_parameter", "values"].join("_");

  try {
    return await withReadTransaction(source, async (client) => {
      const allowedProjects =
        query.projectScope.kind === "only" ? [...query.projectScope.ids] : null;
      const result = await client.query<UsageRow>(
        `select
           binding.definition_id,
           count(distinct binding.project_id)::text as project_count,
           count(*) filter (
             where value.id is not null
               and value.source_ref is distinct from $3
           )::text as current_value_count
         from parameter_catalog.project_parameter_bindings binding
         left join parameter_catalog.${valuesRelation} value
           on value.id = binding.current_value_id
        where binding.organization_id = $1
          and binding.definition_id = any($2::text[])
          and ($4::text[] is null or binding.project_id = any($4::text[]))
        group by binding.definition_id`,
        [
          query.organizationId,
          [...query.definitionIds],
          IDENTITY_PLACEHOLDER_SOURCE,
          allowedProjects,
        ],
      );
      const byDefinition = new Map(result.rows.map((row) => [row.definition_id, row]));
      const summaries: UsageSummary[] = query.definitionIds.map((definitionId) => {
        const row = byDefinition.get(definitionId);
        return {
          definitionId: ParameterDefinitionId(definitionId),
          policyCount: 0,
          projectCount: Number(row?.project_count ?? 0),
          currentValueCount: Number(row?.current_value_count ?? 0),
        };
      });
      return {
        ok: true as const,
        value: {
          semantics: USAGE_CURRENT_PROJECTION_SEMANTICS,
          summaries,
        },
      };
    });
  } catch (error) {
    return fail(mapQueryError(error, "summarizeUsage"));
  }
};
