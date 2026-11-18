import { parseArgs } from "node:util";
import pg from "pg";
import { z } from "zod";

const traceStatsSql = `
  with trace as (
    select step.organization_id, step.run_id, step.step->>'kind' as kind,
      case when jsonb_typeof(step.step->'inputTokens') = 'number' then (step.step->>'inputTokens')::numeric end as input_tokens,
      case when jsonb_typeof(step.step->'outputTokens') = 'number' then (step.step->>'outputTokens')::numeric end as output_tokens
    from public.log_analysis_trace_steps step
    join public.log_analysis_runs run on run.organization_id = step.organization_id and run.id = step.run_id
    where run.status = 'complete'
      and ($1::timestamptz is null or run.completed_at >= $1)
      and ($2::timestamptz is null or run.completed_at < $2)
  ), runs as (
    select organization_id, run_id,
      count(*) filter (where kind = 'model-turn') as steps,
      bool_or(kind = 'early-convergence') as early_converged
    from trace
    group by organization_id, run_id
  ), run_stats as (
    select count(*) as traced_runs,
      count(*) filter (where early_converged) as early_converged_runs,
      count(*) filter (where exists (
        select 1 from public.log_analysis_reports report
        where report.organization_id = runs.organization_id and report.run_id = runs.run_id
          and report.degraded_reason is not null
      )) as degraded_runs,
      json_build_object(
        'samples', count(*),
        'median', percentile_cont(0.5) within group (order by steps),
        'p95', percentile_disc(0.95) within group (order by steps)
      ) as steps
    from runs
  ), turn_stats as (
    select count(*) as model_turns,
      json_build_object(
        'samples', count(input_tokens),
        'median', percentile_cont(0.5) within group (order by input_tokens),
        'p95', percentile_disc(0.95) within group (order by input_tokens)
      ) as input_tokens,
      json_build_object(
        'samples', count(output_tokens),
        'median', percentile_cont(0.5) within group (order by output_tokens),
        'p95', percentile_disc(0.95) within group (order by output_tokens)
      ) as output_tokens
    from trace where kind = 'model-turn'
  )
  select json_build_object(
    'tracedRuns', traced_runs,
    'modelTurns', model_turns,
    'inputTokens', input_tokens,
    'outputTokens', output_tokens,
    'steps', steps,
    'earlyConvergedRuns', early_converged_runs,
    'earlyConvergenceRate', early_converged_runs::numeric / nullif(traced_runs, 0),
    'degradedRuns', degraded_runs,
    'degradationRate', degraded_runs::numeric / nullif(traced_runs, 0)
  ) as stats
  from run_stats cross join turn_stats
`;

async function main() {
  const { values: { since, until, help } } = parseArgs({
    options: { since: { type: "string" }, until: { type: "string" }, help: { type: "boolean" } }
  });
  if (help) {
    console.log("Set LOG_ANALYSIS_TRACE_DATABASE_URL to a read-only PostgreSQL URL.\n"
      + "Usage: npx tsx scripts/log-analysis-trace-stats.ts [--since <ISO timestamp>] [--until <ISO timestamp>]");
    return;
  }

  const databaseUrl = process.env.LOG_ANALYSIS_TRACE_DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("Set LOG_ANALYSIS_TRACE_DATABASE_URL to the target PostgreSQL database.");
  const timestamp = z.string().datetime({ offset: true });
  if ([since, until].some((value) => value !== undefined && !timestamp.safeParse(value).success)) {
    throw new Error("--since and --until must be ISO timestamps with a time zone.");
  }
  if (since && until && Date.parse(since) >= Date.parse(until)) {
    throw new Error("--since must be earlier than --until.");
  }

  let client: pg.Client | undefined;
  try {
    client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
    await client.connect();
    await client.query("begin read only");
    await client.query("set local statement_timeout = '60s'");
    const { rows } = await client.query<{ stats: unknown }>(traceStatsSql, [since ?? null, until ?? null]);
    console.log(JSON.stringify(rows[0].stats, null, 2));
  } catch (error) {
    // Database errors can include connection details. Print only the error code.
    const code = (error as { code?: unknown })?.code;
    const detail = typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : "";
    throw new Error(`Could not read log analysis trace statistics${detail}. Check the connection, schema and SELECT permissions.`);
  } finally {
    await client?.end();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
