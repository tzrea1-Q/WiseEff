import type { AgentToolDefinition, AgentToolExecutionContext } from "../toolRegistry";
import { requireAgentToolMetadata } from "../toolMetadata";
import { ApiError } from "../../../shared/http/errors";
import { getRootPostgresPool, isRootDatabase } from "../../../shared/database/client";
import { assertTrustedInvocationContext } from "../../auth/trustedInvocation";
import { readProjectProtectedParameters } from "../../parameter-bindings/adapters";
import type { OptionalValue } from "../../parameter-catalog-contract";

type ToolOptions = {
  db: { query<Row>(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }> };
};

type NodeSnapshotRow = {
  id: string;
  name: string;
  current_value: string;
  target_value: string;
  node_path: string | null;
  protocol: string | null;
};

type LogConclusionRow = {
  id: string;
  status: string;
  severity: string;
  conclusion: string | null;
};

function readProjectId(contextProjectId: string | undefined, payload: Record<string, unknown>) {
  return typeof payload.projectId === "string" ? payload.projectId : contextProjectId;
}

function optional<T>(value: OptionalValue<T>): T | null {
  return value.kind === "present" ? value.value : null;
}

async function readConfiguredParameters(options: ToolOptions, context: AgentToolExecutionContext, projectId?: string) {
  const invocation = assertTrustedInvocationContext(context.invocation);
  if (
    invocation.initiator !== "agent" ||
    invocation.principal.user.id !== context.auth.user.id ||
    invocation.principal.organization.id !== context.auth.organization.id ||
    invocation.sessionId !== context.sessionId ||
    invocation.toolCallId !== context.toolCallId
  ) {
    throw new ApiError("FORBIDDEN", "Parameter perception requires the authenticated Agent invocation.");
  }
  const pool = isRootDatabase(options.db) ? getRootPostgresPool(options.db) : undefined;
  if (!pool) throw new ApiError("INTERNAL_ERROR", "Canonical parameter reads require the real database boundary.");
  return readProjectProtectedParameters(pool, { invocation, projectId });
}

export function createPerceptionTools(options: ToolOptions): AgentToolDefinition[] {
  return [
    {
      ...requireAgentToolMetadata("perception.getProjectOverview"),
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const parameters = await readConfiguredParameters(options, context, projectId);
        const counted = await options.db.query<{ count: number }>(
          `select count(*)::int as count from parameter_change_requests
            where organization_id = $1 and project_id = $2
              and status not in ('merged', 'rejected', 'withdrawn')`,
          [context.auth.organization.id, projectId]
        );
        const openRequests = counted.rows[0]?.count;
        if (openRequests === undefined) throw new ApiError("INTERNAL_ERROR", "Project overview count is unavailable.");
        return {
          summary: `Project ${projectId}: ${parameters.length} parameters, ${openRequests} open change requests.`,
          data: {
            project_id: projectId,
            parameter_count: parameters.length,
            open_change_requests: openRequests,
            pin_status: "canonical-pin"
          },
          citations: [{ type: "parameter", id: String(projectId), label: `Project ${projectId} overview` }]
        };
      }
    },
    {
      ...requireAgentToolMetadata("perception.searchParameters"),
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const query = typeof payload.query === "string" ? payload.query.trim() : "";
        const needle = query.toLowerCase();
        const configured = await readConfiguredParameters(options, context, projectId);
        const parameters = configured
          .filter((item) => {
            const content = item.revision.content;
            return (
              !needle ||
              [
                item.propertyKey,
                content.displayName,
                optional(content.description),
                optional(content.documentation)
              ].some((text) => text?.toLowerCase().includes(needle))
            );
          })
          .slice(0, 20)
          .map((item) => {
            const content = item.revision.content;
            const unit = optional(content.unit);
            const value = item.pin.payload.value;
            return {
              id: item.pin.bindingId,
              name: content.displayName || item.propertyKey,
              description: optional(content.description),
              explanation: optional(content.documentation),
              module: null,
              range: null,
              unit: unit?.symbol ?? null,
              project_id: item.pin.projectId,
              current_value: typeof value === "object" ? JSON.stringify(value) : String(value),
              policy_target: null,
              schema_default: optional(content.schemaDefault),
              risk: null,
              pin_status: "canonical-pin",
              pin: item.pin
            };
          });
        return {
          summary:
            parameters.length > 0
              ? `Found ${parameters.length} parameters${query ? ` matching "${query}"` : ""}.`
              : `No parameters found${query ? ` matching "${query}"` : ""}.`,
          data: { parameters },
          citations: parameters.map((item) => ({
            type: "parameter" as const,
            id: item.id,
            label: item.name,
            href: `/parameters?bindingId=${encodeURIComponent(item.id)}`,
            snippet: item.description || item.explanation || item.current_value
          }))
        };
      }
    },
    {
      ...requireAgentToolMetadata("perception.getNodeSnapshot"),
      run: async (context, _payload) => {
        const { rows } = await options.db.query<NodeSnapshotRow>(
          `
select p.id,
       p.name,
       p.current_value,
       p.target_value,
       b.node_path,
       b.protocol
from debugging_parameters p
left join debugging_parameter_node_bindings b
  on b.parameter_id = p.id
 and b.organization_id = p.organization_id
 and b.enabled = true
where p.organization_id = $1
  and p.enabled = true
  and p.archived_at is null
order by p.sort_order asc, p.name asc
limit 20
          `,
          [context.auth.organization.id]
        );
        return {
          summary: `Node snapshot: ${rows.length} debugging parameters with bindings.`,
          data: { nodes: rows },
          citations: rows.map((row) => ({
            type: "debugging" as const,
            id: row.id,
            label: row.name,
            href: `/debugging?parameterId=${encodeURIComponent(row.id)}`,
            snippet: row.node_path ? `${row.protocol ?? "unknown"}://${row.node_path}` : undefined
          }))
        };
      }
    },
    {
      ...requireAgentToolMetadata("perception.getRecentLogConclusions"),
      run: async (context, _payload) => {
        const { rows } = await options.db.query<LogConclusionRow>(
          `
select lr.id,
       lr.status,
       coalesce(report.severity, 'unknown') as severity,
       coalesce(report.conclusion, lr.failure_reason) as conclusion
from log_records lr
left join log_analysis_reports report on report.run_id = lr.current_run_id
where lr.organization_id = $1
order by lr.captured_at desc
limit 10
          `,
          [context.auth.organization.id]
        );
        const primary = rows[0];
        return {
          summary: primary?.conclusion
            ? `Most recent log conclusion: ${primary.conclusion}`
            : `Found ${rows.length} recent log records.`,
          data: { logs: rows },
          citations: rows.map((row) => ({
            type: "log" as const,
            id: row.id,
            label: `${row.severity} ${row.status} log`,
            href: `/logs?logId=${encodeURIComponent(row.id)}`,
            snippet: row.conclusion ?? undefined
          }))
        };
      }
    }
  ];
}
