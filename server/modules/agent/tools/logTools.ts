import type { AgentToolDefinition } from "../toolRegistry";

type ToolOptions = {
  db: {
    query<Row>(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
  };
};

type LogRecordRow = {
  id: string;
  project_id?: string | null;
  status: string;
  severity: string;
  confidence?: number | string | null;
  conclusion?: string | null;
};

function readProjectId(contextProjectId: string | undefined, payload: Record<string, unknown>) {
  return typeof payload.projectId === "string" ? payload.projectId : contextProjectId;
}

function logCitation(row: LogRecordRow) {
  return {
    type: "log" as const,
    id: row.id,
    label: `${row.severity} ${row.status} log`,
    href: `/logs?logId=${encodeURIComponent(row.id)}`,
    snippet: row.conclusion ?? undefined,
    confidence: row.confidence == null ? undefined : Number(row.confidence)
  };
}

export function createLogTools(options: ToolOptions): AgentToolDefinition[] {
  return [
    {
      name: "log.explainRootCause",
      label: "Explain root cause",
      kind: "read",
      permission: "logs:view",
      requiresApproval: false,
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const result = await options.db.query<LogRecordRow>(
          `
select
  lr.id,
  lr.project_id,
  lr.status,
  coalesce(report.severity, 'unknown') as severity,
  report.confidence,
  coalesce(report.conclusion, lr.failure_reason) as conclusion
from log_records lr
left join log_analysis_reports report on report.run_id = lr.current_run_id
where lr.organization_id = $1
  and ($2::text is null or lr.project_id = $2)
order by lr.captured_at desc
limit 10
          `,
          [context.auth.organization.id, projectId ?? null]
        );
        const primary = result.rows[0];

        return {
          summary: primary?.conclusion
            ? `Most recent log root cause: ${primary.conclusion}.`
            : `Found ${result.rows.length} recent log records for root-cause review.`,
          data: { logs: result.rows },
          citations: result.rows.map(logCitation)
        };
      }
    },
    {
      name: "log.generateChecklist",
      label: "Generate log checklist",
      kind: "read",
      permission: "logs:view",
      requiresApproval: false,
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const result = await options.db.query<LogRecordRow>(
          `
select
  lr.id,
  lr.project_id,
  lr.status,
  coalesce(report.severity, 'unknown') as severity,
  report.confidence,
  coalesce(report.conclusion, lr.failure_reason) as conclusion
from log_records lr
left join log_analysis_reports report on report.run_id = lr.current_run_id
where lr.organization_id = $1
  and ($2::text is null or lr.project_id = $2)
  and (lr.status = 'failed' or lower(coalesce(report.severity, '')) in ('high', 'critical'))
order by lr.captured_at desc
limit 10
          `,
          [context.auth.organization.id, projectId ?? null]
        );
        const items = result.rows.map((row) => `Review ${row.severity} ${row.status} log: ${row.conclusion ?? row.id}`);

        return {
          summary: `Generated ${items.length} log investigation checklist items.`,
          data: { items },
          citations: result.rows.map(logCitation)
        };
      }
    }
  ];
}
