import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";

describe.skipIf(!(await isTestDatabaseAvailable()))("log trace statistics command over PostgreSQL", () => {
  it("summarizes model turns and completed traced runs in the requested time window", async () => {
    const ephemeral = await createEphemeralTestDatabase("tracestat");
    const db = createPostgresDatabase(ephemeral.url);
    const stats = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [
      "--import", "tsx", "scripts/log-analysis-trace-stats.ts", ...args
    ], {
      encoding: "utf8", timeout: 15_000,
      env: { ...process.env, LOG_ANALYSIS_TRACE_DATABASE_URL: ephemeral.url }
    }));

    try {
      await seedCoreGraph(db, { organization: { id: "stats-org", name: "Trace statistics" } });
      await db.query(`insert into log_file_objects
        (id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256)
        values ('stats-file', 'stats-org', 'private-file', 'private.log', 'text/plain', 10, 'fixture')`);
      await db.query(`insert into log_records (id, organization_id, file_object_id, file_name, source, status)
        values ('stats-log', 'stats-org', 'stats-file', 'private.log', 'upload', 'complete')`);
      await db.query(`insert into log_analysis_runs (id, organization_id, log_record_id, status, current_stage, completed_at)
        select id, 'stats-org', 'stats-log', status, 'report', completed_at::timestamptz
        from (values
          ('healthy', 'complete', '2026-11-18T00:00:00Z'),
          ('converged', 'complete', '2026-11-18T01:00:00Z'),
          ('fallback', 'complete', '2026-11-18T02:00:00Z'),
          ('untraced', 'complete', '2026-11-18T03:00:00Z'),
          ('outside', 'complete', '2026-11-19T00:00:00Z'),
          ('unfinished', 'processing', null)
        ) as runs(id, status, completed_at)`);
      await db.query(`insert into log_analysis_reports
        (id, organization_id, log_record_id, run_id, confidence, conclusion, impact, severity,
         suggested_actions, raw_lines, analysis_source, degraded_reason)
        values
          ('report-healthy', 'stats-org', 'stats-log', 'healthy', 0.9, 'private', '', 'Info', '[]', '[]', 'agent', null),
          ('report-converged', 'stats-org', 'stats-log', 'converged', 0.5, 'private', '', 'Info', '[]', '[]', 'agent', 'step-budget-exhausted'),
          ('report-fallback', 'stats-org', 'stats-log', 'fallback', 0.4, 'private', '', 'Info', '[]', '[]', 'rules-fallback', 'provider-unavailable')`);
      await db.query(`insert into log_analysis_trace_steps (organization_id, run_id, step_index, step)
        select 'stats-org', run_id, step_index, step::jsonb
        from (values
          ('healthy', 1, '{"kind":"model-turn","inputTokens":100,"outputTokens":0}'),
          ('healthy', 2, '{"kind":"tool-call","inputTokens":999}'),
          ('healthy', 3, '{"kind":"model-turn","inputTokens":200,"outputTokens":20}'),
          ('converged', 1, '{"kind":"early-convergence","reason":"step-budget-exhausted"}'),
          ('converged', 2, '{"kind":"model-turn","inputTokens":300}'),
          ('fallback', 1, '{"kind":"degradation","reason":"provider-unavailable"}'),
          ('fallback', 2, '{"kind":"rule-fallback"}'),
          ('outside', 1, '{"kind":"model-turn","inputTokens":999}'),
          ('unfinished', 1, '{"kind":"model-turn","inputTokens":999}')
        ) as steps(run_id, step_index, step)`);

      expect(stats("--since", "2026-11-18T00:00:00Z", "--until", "2026-11-19T00:00:00Z")).toEqual({
        tracedRuns: 3,
        modelTurns: 3,
        inputTokens: { samples: 3, median: 200, p95: 300 },
        outputTokens: { samples: 2, median: 10, p95: 20 },
        steps: { samples: 3, median: 1, p95: 2 },
        earlyConvergedRuns: 1,
        earlyConvergenceRate: expect.closeTo(1 / 3),
        degradedRuns: 2,
        degradationRate: expect.closeTo(2 / 3)
      });
      const empty = { samples: 0, median: null, p95: null };
      expect(stats("--until", "2026-11-18T00:00:00Z")).toEqual({
        tracedRuns: 0, modelTurns: 0, inputTokens: empty, outputTokens: empty, steps: empty,
        earlyConvergedRuns: 0, earlyConvergenceRate: null, degradedRuns: 0, degradationRate: null
      });
    } finally {
      await db.close();
      await ephemeral.drop();
    }
  });
});
