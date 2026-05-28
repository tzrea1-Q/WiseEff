import type { AgentToolDefinition } from "../toolRegistry";

type ToolOptions = {
  db: {
    query<Row>(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
  };
};

type DebuggingParameterRow = {
  id: string;
  project_id?: string | null;
  name: string;
  current_value?: string | null;
  target_value?: string | null;
  status?: string | null;
  risk?: string | null;
  is_writable?: boolean | null;
};

type DebuggingSnapshotRow = {
  id: string;
  project_id?: string | null;
  parameter_id: string;
  parameter_name?: string | null;
  value?: string | null;
  created_at?: string | null;
};

function readProjectId(contextProjectId: string | undefined, payload: Record<string, unknown>) {
  return typeof payload.projectId === "string" ? payload.projectId : contextProjectId;
}

export function createDebuggingTools(options: ToolOptions): AgentToolDefinition[] {
  return [
    {
      name: "debugging.recommendTargetValues",
      label: "Recommend target values",
      kind: "read",
      permission: "debugging:view",
      requiresApproval: false,
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const result = await options.db.query<DebuggingParameterRow>(
          `
select
  id,
  project_id,
  name,
  current_value,
  target_value,
  case when target_value is distinct from current_value then 'pending' else 'ready' end as status,
  risk,
  (access_mode in ('rw', 'write', 'read-write')) as is_writable
from debugging_parameters
where organization_id = $1
  and ($2::text is null or project_id = $2)
  and access_mode in ('rw', 'write', 'read-write')
  and (target_value is distinct from current_value or lower(risk) in ('high', 'critical'))
order by updated_at desc
limit 20
          `,
          [context.auth.organization.id, projectId ?? null]
        );

        return {
          summary: `Recommended ${result.rows.length} writable debugging target value candidates.`,
          data: { candidates: result.rows },
          citations: result.rows.map((row) => ({
            type: "debugging" as const,
            id: row.id,
            label: row.name,
            href: `/debugging?parameterId=${encodeURIComponent(row.id)}`,
            snippet: `${row.current_value ?? "unknown"} -> ${row.target_value ?? "unset"} (${row.risk ?? "unknown"} risk)`
          }))
        };
      }
    },
    {
      name: "debugging.prepareRollback",
      label: "Prepare rollback",
      kind: "preparation",
      permission: "debugging:rollback",
      requiresApproval: true,
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const result = await options.db.query<DebuggingSnapshotRow>(
          `
select
  id,
  project_id,
  coalesce(entries->0->>'parameterId', entries->0->>'parameter_id', operation_id) as parameter_id,
  coalesce(entries->0->>'parameterName', entries->0->>'parameter_name', operation_id) as parameter_name,
  coalesce(entries->0->>'previousValue', entries->0->>'previous_value', entries->0->>'value') as value,
  created_at
from debugging_snapshots
where organization_id = $1
  and ($2::text is null or project_id = $2)
order by created_at desc
limit 20
          `,
          [context.auth.organization.id, projectId ?? null]
        );
        const steps = result.rows.map((row) => ({
          snapshotId: row.id,
          parameterId: row.parameter_id,
          restoreValue: row.value,
          capturedAt: row.created_at
        }));

        return {
          summary: `Prepared rollback plan from ${steps.length} debugging snapshots. No rollback was executed.`,
          data: { steps },
          citations: result.rows.map((row) => ({
            type: "debugging" as const,
            id: row.id,
            label: row.parameter_name ?? row.parameter_id,
            href: `/debugging?rollbackSnapshotId=${encodeURIComponent(row.id)}`,
            snippet: `Restore ${row.parameter_name ?? row.parameter_id} to ${row.value ?? "previous value"}.`
          }))
        };
      }
    }
  ];
}
