import { describe, expect, it, vi } from "vitest";
import { createAuditClient } from "./auditClient";

describe("auditClient", () => {
  it("lists audit events with query params", async () => {
    const get = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const client = createAuditClient({ get } as never);

    await client.listAuditEvents({
      projectId: "aurora",
      app: "parameter-management",
      severity: "High",
      limit: 25
    });

    expect(get).toHaveBeenCalledWith(
      "/api/v1/audit-events?projectId=aurora&app=parameter-management&severity=High&limit=25"
    );
  });
});
