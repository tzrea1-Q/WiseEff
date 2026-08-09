import { describe, expect, it, vi } from "vitest";

import { createWorkbenchActivitySession } from "./workbenchActivitySession";

describe("WorkbenchActivitySession", () => {
  it("loads audit events and candidate ids via injected apps", async () => {
    const session = createWorkbenchActivitySession();
    const listAuditEvents = vi.fn(async () => ({
      items: [
        {
          id: "evt-1",
          organizationId: "org",
          projectId: "proj",
          app: "parameter-admin",
          action: "update",
          actorUserId: "u1",
          severity: "Info" as const,
          kind: "parameter.update",
          createdAt: "2026-08-09T00:00:00.000Z",
          metadata: {}
        }
      ],
      nextCursor: null
    }));
    const listCandidates = vi.fn(async () => [{ id: "cand-1" }]);

    await session.refresh("proj", ["parameter-admin", "parameters"], listAuditEvents, {
      listCandidates: listCandidates as never
    });

    expect(listAuditEvents).toHaveBeenCalledWith({
      projectId: "proj",
      apps: ["parameter-admin", "parameters"],
      limit: 40
    });
    expect(session.activityEvents).toHaveLength(1);
    expect(session.knownCandidateIds).toEqual(["cand-1"]);
    expect(session.activityLoading).toBe(false);
  });

  it("ignores stale refresh responses", async () => {
    const session = createWorkbenchActivitySession();
    let resolveFirst: (value: { items: []; nextCursor: null }) => void = () => undefined;
    const first = new Promise<{ items: []; nextCursor: null }>((resolve) => {
      resolveFirst = resolve;
    });
    const listAuditEvents = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({
        items: [
          {
            id: "evt-2",
            organizationId: "org",
            projectId: "proj",
            app: "parameters",
            action: "update",
            actorUserId: "u1",
            severity: "Info" as const,
            kind: "parameter.update",
            createdAt: "2026-08-09T00:00:00.000Z",
            metadata: {}
          }
        ],
        nextCursor: null
      });
    const repo = { listCandidates: vi.fn(async () => []) };

    const pending = session.refresh("proj", ["parameters"], listAuditEvents, repo);
    const second = session.refresh("proj", ["parameters"], listAuditEvents, repo);
    resolveFirst({ items: [], nextCursor: null });
    await Promise.all([pending, second]);
    expect(session.activityEvents.map((item) => item.id)).toEqual(["evt-2"]);
  });
});
