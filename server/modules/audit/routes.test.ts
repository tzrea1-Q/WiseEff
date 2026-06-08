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
