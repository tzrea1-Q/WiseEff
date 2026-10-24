import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWiseEffServer } from "../../app";
import type { Database } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import * as repository from "./repository";

vi.mock("./repository", () => ({
  createAuditEvent: vi.fn(),
  listAuditEvents: vi.fn()
}));

function makeDb(input: { userId?: string; organizationId?: string; email?: string; roleId?: string; isActive?: boolean } = {}): Database {
  const userId = input.userId ?? "u-auditor";
  const organizationId = input.organizationId ?? "org-prod";
  const email = input.email ?? "auditor@example.com";
  const query: Database["query"] = async <Row,>(text: string) => {
    if (text.includes("users.id as user_id")) {
      return {
        rows: [
          {
            user_id: userId,
            organization_id: organizationId,
            organization_name: "Pilot Org",
            name: "Auditor",
            email,
            title: "Auditor",
            is_active: input.isActive ?? true,
            project_id: "aurora",
            role_id: input.roleId ?? "guest"
          }
        ] as Row[],
        rowCount: 1
      };
    }
    return { rows: [] as Row[], rowCount: 0 };
  };

  return {
    query,
    transaction: vi.fn()
  };
}

describe("audit routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes eventId and info read filters under the authenticated organization and still rejects info writes", async () => {
    vi.mocked(repository.listAuditEvents).mockResolvedValue({ items: [], nextCursor: null });
    const server = createWiseEffServer({
      db: makeDb({ roleId: "admin" }),
      auth: { mode: "production", verifier: { verify: async () => ({
        user: { id: "u-auditor", organizationId: "org-prod", name: "Auditor", email: "auditor@example.com", title: "Auditor", isActive: true },
        organization: { id: "org-prod", name: "Pilot Org" },
        roles: [{ projectId: "aurora", roleId: "admin" }],
        permissions: ["admin:access"]
      }) } }
    });
    const denied = await requestJson(server, "/api/v1/audit-events?organizationId=foreign");
    expect(denied.status).toBe(403);
    expect(repository.listAuditEvents).not.toHaveBeenCalled();
    const response = await requestJson(server, "/api/v1/audit-events?eventId=event-1&severity=info");
    expect(response.status).toBe(200);
    expect(repository.listAuditEvents).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organizationId: "org-prod", eventId: "event-1", severity: "info" }));
    const multi = await requestJson(server, "/api/v1/audit-events?severities=High,Medium");
    expect(multi.status).toBe(200);
    expect(repository.listAuditEvents).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ organizationId: "org-prod", severities: ["High", "Medium"] }));
    for (const severities of ["High,invalid", "", "High,Medium,Low,info,High"]) {
      vi.mocked(repository.listAuditEvents).mockClear();
      const invalid = await requestJson(server, `/api/v1/audit-events?severities=${severities}`);
      expect(invalid.status).toBe(400);
      expect(repository.listAuditEvents).not.toHaveBeenCalled();
    }
    const write = await requestJson(server, "/api/v1/audit-events", {
      method: "POST", body: JSON.stringify({ app: "parameter-admin", kind: "export", action: "export", severity: "info" })
    });
    expect(write.status).toBe(400);
    expect(repository.createAuditEvent).not.toHaveBeenCalled();
    for (const dateQuery of [
      "from=not-a-date", "to=2026-02-31T00%3A00%3A00.000Z",
      "from=2026-10-16T00%3A00%3A00.000Z&to=2026-10-15T00%3A00%3A00.000Z"
    ]) {
      vi.mocked(repository.listAuditEvents).mockClear();
      const invalid = await requestJson(server, `/api/v1/audit-events?${dateQuery}`);
      expect(invalid.status).toBe(400);
      expect(repository.listAuditEvents).not.toHaveBeenCalled();
    }
    const dates = await requestJson(server, "/api/v1/audit-events?from=2026-10-15T00%3A00%3A00.000Z&to=2026-10-16T00%3A00%3A00.000Z");
    expect(dates.status).toBe(200);
  });

  it("rejects audit creation without a database adapter", async () => {
    const response = await requestJson<{ error: { code: string } }>(createWiseEffServer(), "/api/v1/audit-events", {
      method: "POST",
      body: JSON.stringify({
        app: "parameter-admin",
        kind: "export",
        action: "Exported parameter snapshot",
        severity: "Low",
        metadata: {}
      })
    });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("rejects production audit reads without bearer auth", async () => {
    const db = makeDb();

    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({
        db,
        auth: {
          mode: "production",
          verifier: {
            verify: async () => {
              throw new Error("Authorization bearer token is required.");
            }
          }
        }
      }),
      "/api/v1/audit-events"
    );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects audit reads without admin access and does not call the repository", async () => {
    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({
        db: makeDb(),
        auth: {
          mode: "production",
          verifier: {
            verify: async () => ({
              user: {
                id: "u-auditor",
                organizationId: "org-prod",
                name: "Auditor",
                email: "auditor@example.com",
                title: "Auditor",
                isActive: true
              },
              organization: { id: "org-prod", name: "Pilot Org" },
              roles: [{ projectId: "aurora", roleId: "guest" }],
              permissions: ["parameter:view"]
            })
          }
        }
      }),
      "/api/v1/audit-events"
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(repository.listAuditEvents).not.toHaveBeenCalled();
  });

  it("rejects audit writes without admin access and does not call the repository", async () => {
    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({
        db: makeDb(),
        auth: {
          mode: "production",
          verifier: {
            verify: async () => ({
              user: {
                id: "u-auditor",
                organizationId: "org-prod",
                name: "Auditor",
                email: "auditor@example.com",
                title: "Auditor",
                isActive: true
              },
              organization: { id: "org-prod", name: "Pilot Org" },
              roles: [{ projectId: "aurora", roleId: "guest" }],
              permissions: ["parameter:view"]
            })
          }
        }
      }),
      "/api/v1/audit-events",
      {
        method: "POST",
        body: JSON.stringify({
          app: "parameter-admin",
          kind: "export",
          action: "Exported parameter snapshot",
          severity: "Low",
          metadata: {}
        })
      }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(repository.createAuditEvent).not.toHaveBeenCalled();
  });
});
