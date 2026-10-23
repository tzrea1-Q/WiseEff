import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../shared/database/client";
import type { CreateAuditEventInput } from "../audit/types";
import { buildTrustedAuditEventInput } from "../audit/trustedAudit";
import type { AuthContext } from "../auth/types";
import { createDebuggingService } from "./service";

vi.mock("../agent/repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("../agent/repository")>(),
  updateAgentToolCall: vi.fn(async () => true),
  getAgentApproval: vi.fn(async () => ({ status: "approved", requestedByUserId: "user-1", toolCallId: "tool-1" })),
  getAgentToolCall: vi.fn(async () => ({
    id: "tool-1", sessionId: "agent-session-1", name: "action.writeDebugNode",
    payload: { sessionId: "debug-session-1", parameterId: "parameter-1", value: "3200" }
  }))
}));

vi.mock("./repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("./repository")>(),
  getDebugSession: vi.fn(async () => ({
    id: "debug-session-1", status: "active", actorUserId: "user-1", protocol: "hdc",
    targetId: "target-1", deviceId: "device-1", executionMode: "server"
  })),
  getDebugParameter: vi.fn(async () => ({
    id: "parameter-1", name: "Current", risk: "High", enabled: true, archivedAt: null,
    minValue: null, maxValue: null, valueKind: "scalar", valueFormat: "raw", normalizationMode: "trim"
  })),
  getDebugParameterNodeBinding: vi.fn(async () => ({ nodePath: "/sys/current", accessMode: "RW", enabled: true })),
  resolveDebugNodeIdByBinding: vi.fn(async () => null),
  getDebugTarget: vi.fn(async () => ({ targetRef: "simulator://target" })),
  acquireDebugDeviceLease: vi.fn(async () => ({ sessionId: "debug-session-1" })),
  createDebugSnapshot: vi.fn(async () => ({ id: "snapshot-1" })),
  insertNodeOperation: vi.fn(async (_db: unknown, input: Record<string, unknown>) => ({ id: "operation-1", ...input })),
  linkOperationSnapshot: vi.fn(),
  updateDebugParameterValues: vi.fn()
}));

const auth: AuthContext = {
  user: { id: "user-1", organizationId: "org-1", name: "User", title: "Engineer", isActive: true },
  organization: { id: "org-1", name: "Organization" },
  roles: [{ roleId: "software-user", projectId: null }],
  permissions: ["debugging:view", "debugging:write"]
};

describe("debugging write audit provenance", () => {
  it.each([false, true])("keeps approved Agent provenance=%s through writeNode", async (approved) => {
    const db: Database = {
      query: vi.fn<Database["query"]>(async <Row,>(sql: string) => sql.includes("from public.organizations")
        ? { rows: [{ ...auth.organization, status: "active" }] as Row[], rowCount: 1 }
        : { rows: [], rowCount: 0 }),
      transaction: async (fn) => fn(db)
    };
    const events: CreateAuditEventInput[] = [];
    const service = createDebuggingService({
      db,
      gateway: {
        detectTargets: vi.fn(),
        readNode: vi.fn(async () => ({ ok: true, value: "3000", durationMs: 1 })),
        writeNode: vi.fn(async () => ({
          ok: true, verified: true, value: "3200",
          writeResult: { ok: true, durationMs: 1 },
          readResult: { ok: true, value: "3200", durationMs: 1 }
        }))
      },
      writeAuditEvent: async (_tx, event) => { events.push(buildTrustedAuditEventInput(event)); }
    });

    await service.writeNode(auth, {
      sessionId: "debug-session-1", parameterId: "parameter-1", value: "3200",
      ...(approved ? { approvalId: "approval-1" } : { confirmationToken: "confirm-high-risk-write" })
    }, { requestId: "request-1" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorType: approved ? "agent" : "user", actorUserId: auth.user.id,
      organizationId: auth.organization.id, traceId: "request-1",
      metadata: approved
        ? { initiator: "agent", sessionId: "agent-session-1", toolCallId: "tool-1", approvalId: "approval-1" }
        : { initiator: "user", sessionId: "debug-session-1" }
    });
  });
});
