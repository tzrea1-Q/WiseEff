import type { AgentToolDefinition } from "../toolRegistry";

type ToolOptions = {
  db: {
    query<Row>(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
  };
};

type AuditEventRow = {
  id: string;
  project_id?: string | null;
  event_type?: string | null;
  kind?: string | null;
  actor_user_id?: string | null;
  created_at?: string | null;
};

function readProjectId(contextProjectId: string | undefined, payload: Record<string, unknown>) {
  return typeof payload.projectId === "string" ? payload.projectId : contextProjectId;
}

export function createAuditTools(options: ToolOptions): AgentToolDefinition[] {
  return [
    {
      name: "audit.summarizeRecentEvents",
      label: "Summarize recent audit events",
      kind: "read",
      permission: "admin:access",
      requiresApproval: false,
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const result = await options.db.query<AuditEventRow>(
          `
select
  id,
  project_id,
  kind as event_type,
  actor_user_id,
  created_at
from audit_events
where organization_id = $1
  and ($2::text is null or project_id = $2)
order by created_at desc
limit 20
          `,
          [context.auth.organization.id, projectId ?? null]
        );
        const eventKindCounts = result.rows.reduce<Record<string, number>>((counts, row) => {
          const eventKind = row.event_type ?? row.kind ?? "unknown";
          counts[eventKind] = (counts[eventKind] ?? 0) + 1;
          return counts;
        }, {});

        return {
          summary: `Summarized ${result.rows.length} recent audit events.`,
          data: { events: result.rows, eventKindCounts },
          citations: result.rows.map((row) => {
            const eventKind = row.event_type ?? row.kind ?? "unknown";
            return {
              type: "audit" as const,
              id: row.id,
              label: eventKind,
              href: `/admin/audit?eventId=${encodeURIComponent(row.id)}`,
              snippet: `${eventKind} by ${row.actor_user_id ?? "unknown actor"}`
            };
          })
        };
      }
    }
  ];
}
