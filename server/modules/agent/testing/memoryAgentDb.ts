import type { Database, Queryable } from "../../../shared/database/client";

type MemoryRow = Record<string, unknown>;

function isoNow() {
  return "2026-05-28T00:00:00.000Z";
}

export type MemoryAgentDbOptions = {
  failApprovalUpdates?: boolean;
  failToolUpdateStatuses?: string[];
  failAuditActions?: string[];
};

/**
 * SQL-dispatching in-memory stand-in for the agent tables (sessions, messages,
 * tool calls, approvals, audits). Shared by orchestrator unit tests and the
 * Xiaoze AG-UI assembly tests so both exercise the same persistence contract.
 */
export function createMemoryAgentDb(options: MemoryAgentDbOptions = {}) {
  const tables = {
    sessions: [] as MemoryRow[],
    messages: [] as MemoryRow[],
    toolCalls: [] as MemoryRow[],
    approvals: [] as MemoryRow[],
    traces: [] as MemoryRow[],
    audits: [] as MemoryRow[]
  };

  function cloneTables() {
    return {
      sessions: tables.sessions.map((row) => ({ ...row })),
      messages: tables.messages.map((row) => ({ ...row })),
      toolCalls: tables.toolCalls.map((row) => ({ ...row })),
      approvals: tables.approvals.map((row) => ({ ...row })),
      traces: tables.traces.map((row) => ({ ...row })),
      audits: tables.audits.map((row) => ({ ...row }))
    };
  }

  function replaceTables(nextTables: typeof tables) {
    for (const key of Object.keys(tables) as Array<keyof typeof tables>) {
      tables[key].splice(0, tables[key].length, ...nextTables[key].map((row) => ({ ...row })));
    }
  }

  function queryableFor(targetTables: typeof tables): Queryable {
    return {
      query: async <Row,>(text: string, values: unknown[] = []) => {
        const sql = text.replace(/\s+/g, " ").trim();

        if (sql.includes("insert into agent_sessions")) {
          if (targetTables.sessions.some((row) => row.id === values[0])) {
            return { rows: [] as Row[], rowCount: 0 };
          }
          targetTables.sessions.push({
            id: values[0],
            organization_id: values[1],
            project_id: values[2],
            actor_user_id: values[3],
            page_key: values[4],
            role_id: values[5],
            context: values[6],
            title: values[7],
            status: "active",
            created_at: isoNow(),
            updated_at: isoNow()
          });
          return { rows: [] as Row[], rowCount: 1 };
        }
        if (sql.includes("update agent_sessions") && sql.includes("context = $2::jsonb")) {
          const row = targetTables.sessions.find(
            (item) =>
              item.organization_id === values[2] &&
              item.actor_user_id === values[3] &&
              item.id === values[4] &&
              item.page_key === values[5] &&
              item.status === "active"
          );
          if (!row) {
            return { rows: [] as Row[], rowCount: 0 };
          }
          row.title = values[0];
          row.context = values[1];
          row.updated_at = isoNow();
          return { rows: [] as Row[], rowCount: 1 };
        }
        if (sql.includes("from agent_sessions")) {
          return {
            rows: targetTables.sessions.filter((row) => row.organization_id === values[0] && row.id === values[1]) as Row[],
            rowCount: 1
          };
        }
        if (sql.includes("insert into agent_messages")) {
          if (sql.includes("on conflict") && targetTables.messages.some((row) => row.id === values[0])) {
            return { rows: [] as Row[], rowCount: 0 };
          }
          targetTables.messages.push({
            id: values[0],
            session_id: values[1],
            organization_id: values[2],
            role: values[3],
            content: values[4],
            citations: values[5],
            confidence: values[6],
            metadata: values[7] ?? null,
            created_at: isoNow()
          });
          return { rows: [] as Row[], rowCount: 1 };
        }
        if (sql.includes("from agent_messages")) {
          return {
            rows: targetTables.messages.filter((row) => row.organization_id === values[0] && row.session_id === values[1]) as Row[],
            rowCount: 1
          };
        }
        if (sql.includes("insert into agent_tool_calls")) {
          targetTables.toolCalls.push({
            id: values[0],
            session_id: values[1],
            organization_id: values[2],
            project_id: values[3],
            name: values[4],
            label: values[5],
            payload: values[6],
            requires_approval: values[7],
            status: values[8],
            result: null,
            error_message: null,
            audit_event_id: null,
            created_at: isoNow(),
            updated_at: isoNow()
          });
          return { rows: [] as Row[], rowCount: 1 };
        }
        if (sql.includes("update agent_tool_calls")) {
          if (options.failToolUpdateStatuses?.includes(String(values[2]))) {
            return { rows: [] as Row[], rowCount: 0 };
          }
          const row = targetTables.toolCalls.find((item) => item.organization_id === values[0] && item.id === values[1]);
          if (!row) {
            return { rows: [] as Row[], rowCount: 0 };
          }
          const nextStatus = values[2];
          const isTerminal = ["succeeded", "failed", "rejected"].includes(String(row.status));
          if (nextStatus !== null && row.status !== nextStatus && isTerminal) {
            return { rows: [] as Row[], rowCount: 0 };
          }
          row.status = nextStatus ?? row.status;
          row.result = values[3] ?? row.result;
          row.error_message = values[4] ?? row.error_message;
          row.audit_event_id = values[5] ?? row.audit_event_id;
          row.payload = values[6] ?? row.payload;
          row.updated_at = isoNow();
          return { rows: [] as Row[], rowCount: 1 };
        }
        if (sql.includes("from agent_tool_calls")) {
          const rows = targetTables.toolCalls
            .filter((row) =>
              sql.includes("session_id = $2")
                ? row.organization_id === values[0] && row.session_id === values[1]
                : row.organization_id === values[0] && row.id === values[1]
            )
            .map((row) => ({
              ...row,
              approval_id: targetTables.approvals.find((approval) => approval.tool_call_id === row.id)?.id ?? null
            }));
          return { rows: rows as Row[], rowCount: rows.length };
        }
        if (sql.includes("insert into agent_approvals")) {
          targetTables.approvals.push({
            id: values[0],
            session_id: values[1],
            tool_call_id: values[2],
            organization_id: values[3],
            project_id: values[4],
            status: values[5],
            title: values[6],
            message: values[7],
            requested_by_user_id: values[8],
            requested_at: isoNow(),
            decided_at: null,
            decided_by_user_id: null,
            decision_reason: null
          });
          return { rows: [] as Row[], rowCount: 1 };
        }
        if (sql.includes("update agent_approvals")) {
          if (options.failApprovalUpdates) {
            return { rows: [] as Row[], rowCount: 0 };
          }
          const row = targetTables.approvals.find(
            (item) => item.organization_id === values[0] && item.id === values[1] && item.status === "pending"
          );
          if (!row) {
            return { rows: [] as Row[], rowCount: 0 };
          }
          row.status = sql.includes("status = 'approved'") ? "approved" : "rejected";
          row.decided_by_user_id = values[2];
          row.decision_reason = values[3] ?? null;
          row.decided_at = isoNow();
          return { rows: [] as Row[], rowCount: 1 };
        }
        if (sql.includes("from agent_approvals")) {
          return {
            rows: targetTables.approvals.filter((row) =>
              sql.includes("session_id = $2")
                ? row.organization_id === values[0] && row.session_id === values[1]
                : row.organization_id === values[0] && row.id === values[1]
            ) as Row[],
            rowCount: 1
          };
        }
        if (sql.includes("insert into audit_events")) {
          if (options.failAuditActions?.includes(String(values[7]))) {
            throw new Error("Audit sink unavailable");
          }
          targetTables.audits.push({
            id: values[0],
            organization_id: values[1],
            project_id: values[2],
            actor_user_id: values[3],
            actor_type: values[4],
            app: values[5],
            kind: values[6],
            action: values[7],
            severity: values[8],
            target_type: values[9],
            target_id: values[10],
            metadata: values[11],
            trace_id: values[12]
          });
          return { rows: [] as Row[], rowCount: 1 };
        }

        throw new Error(`Unhandled SQL in test DB: ${sql}`);
      }
    };
  }

  const queryable = queryableFor(tables);

  function asDatabase(target: Queryable): Database {
    const database: Database = {
      ...target,
      // Nested transactions reuse the same table view; the fake commits by
      // replacing the outer tables when the outermost callback resolves.
      transaction: async (nested) => nested(database)
    };
    return database;
  }

  const db: Database = {
    ...queryable,
    transaction: async (fn) => {
      const txTables = cloneTables();
      const tx = asDatabase(queryableFor(txTables));
      const result = await fn(tx);
      replaceTables(txTables);
      return result;
    }
  };

  return { db, tables };
}
