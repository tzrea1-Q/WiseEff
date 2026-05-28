import type { AgentToolDefinition } from "../toolRegistry";

type ToolOptions = {
  db: {
    query<Row>(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
  };
};

type ReviewQueueRow = {
  id: string;
  project_id: string;
  parameter_id: string;
  parameter_name: string;
  status: string;
  risk: string | null;
};

type OrphanParameterRow = {
  id: string;
  project_id?: string | null;
  name: string;
  risk?: string | null;
  last_value_at?: string | null;
  usage_count?: number | string | null;
};

function readProjectId(contextProjectId: string | undefined, payload: Record<string, unknown>) {
  return typeof payload.projectId === "string" ? payload.projectId : contextProjectId;
}

function countBy(rows: { [key: string]: unknown }[], key: string) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const value = String(row[key] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

export function createParameterTools(options: ToolOptions): AgentToolDefinition[] {
  return [
    {
      name: "parameter.scanOrphans",
      label: "Scan orphan parameters",
      kind: "read",
      permission: "admin:access",
      requiresApproval: false,
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const result = await options.db.query<OrphanParameterRow>(
          `
select
  pd.id,
  ppv.project_id,
  pd.name,
  pd.risk,
  max(ppv.updated_at)::text as last_value_at,
  count(ppv.id) as usage_count
from parameter_definitions pd
left join project_parameter_values ppv
  on ppv.parameter_definition_id = pd.id
  and ppv.organization_id = pd.organization_id
  and ($2::text is null or ppv.project_id = $2)
where pd.organization_id = $1
group by pd.id, ppv.project_id, pd.name, pd.risk
having count(ppv.id) = 0 or max(ppv.updated_at) is null
order by pd.name asc
limit 20
          `,
          [context.auth.organization.id, projectId ?? null]
        );

        return {
          summary: `${result.rows.length} parameter definitions need usage or recent value review.`,
          data: { parameters: result.rows },
          citations: result.rows.map((row) => ({
            type: "parameter" as const,
            id: row.id,
            label: row.name,
            href: `/parameters?parameterId=${encodeURIComponent(row.id)}`,
            snippet: row.project_id ? `Project ${row.project_id}` : "No project usage found."
          }))
        };
      }
    },
    {
      name: "parameter.draftCleanupPlan",
      label: "Draft cleanup plan",
      kind: "preparation",
      permission: "admin:access",
      requiresApproval: true,
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const result = await options.db.query<OrphanParameterRow>(
          `
select
  pd.id,
  ppv.project_id,
  pd.name,
  pd.risk,
  max(ppv.updated_at)::text as last_value_at,
  count(ppv.id) as usage_count
from parameter_definitions pd
left join project_parameter_values ppv
  on ppv.parameter_definition_id = pd.id
  and ppv.organization_id = pd.organization_id
  and ($2::text is null or ppv.project_id = $2)
where pd.organization_id = $1
group by pd.id, ppv.project_id, pd.name, pd.risk
having count(ppv.id) = 0 or max(ppv.updated_at) is null
order by pd.name asc
limit 20
          `,
          [context.auth.organization.id, projectId ?? null]
        );

        const actions = result.rows.map((row) => ({
          parameterId: row.id,
          action: "review_cleanup_candidate",
          reason: row.usage_count === 0 || row.usage_count === "0" ? "No project usage found." : "No recent value found."
        }));

        return {
          summary: `Prepared cleanup review plan for ${actions.length} parameter definitions. No parameters were deleted.`,
          data: { actions },
          citations: result.rows.map((row) => ({
            type: "parameter" as const,
            id: row.id,
            label: row.name,
            href: `/parameters?parameterId=${encodeURIComponent(row.id)}`,
            snippet: "Cleanup candidate only; approval execution is required."
          }))
        };
      }
    },
    {
      name: "parameter.summarizeReviewQueue",
      label: "Summarize review queue",
      kind: "read",
      permission: "parameter:review",
      requiresApproval: false,
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const result = await options.db.query<ReviewQueueRow>(
          `
select
  cr.id,
  cr.project_id,
  cr.parameter_definition_id as parameter_id,
  pd.name as parameter_name,
  cr.status,
  pd.risk
from parameter_change_requests cr
join project_parameter_values ppv on ppv.id = cr.project_parameter_value_id
join parameter_definitions pd on pd.id = ppv.parameter_definition_id
where cr.organization_id = $1
  and ($2::text is null or cr.project_id = $2)
order by cr.created_at desc
limit 20
          `,
          [context.auth.organization.id, projectId ?? null]
        );

        const statusCounts = countBy(result.rows, "status");
        const riskCounts = countBy(result.rows, "risk");

        return {
          summary: `${result.rows.length} parameter change requests are waiting in the review queue.`,
          data: { items: result.rows, statusCounts, riskCounts },
          citations: result.rows.map((row) => ({
            type: "parameter" as const,
            id: row.id,
            label: row.parameter_name,
            href: `/parameters/review?changeRequestId=${encodeURIComponent(row.id)}`,
            snippet: `${row.status} ${row.risk ?? "unknown"} risk change for ${row.project_id}.`
          }))
        };
      }
    },
    {
      name: "parameter.submitChangeDraft",
      label: "Submit change draft",
      kind: "preparation",
      permission: "parameter:edit",
      requiresApproval: true,
      run: async (_context, payload) => {
        const parameterId = typeof payload.parameterId === "string" ? payload.parameterId : "unknown";
        return {
          summary: "Prepared a parameter change draft for approval. No draft row was created.",
          data: {
            draft: {
              parameterId,
              proposedValue: payload.proposedValue ?? null,
              reason: payload.reason ?? null,
              approvalRequired: true
            }
          },
          citations: parameterId === "unknown"
            ? []
            : [
                {
                  type: "parameter" as const,
                  id: parameterId,
                  label: parameterId,
                  href: `/parameters?parameterId=${encodeURIComponent(parameterId)}`,
                  snippet: "Draft creation is deferred to approved execution."
                }
              ]
        };
      }
    }
  ];
}
