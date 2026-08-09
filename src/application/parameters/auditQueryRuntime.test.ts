import { describe, expect, it, vi } from "vitest";

import type { AuditQuery } from "@/application/ports/AuditQuery";
import { resolveAuditQuery } from "./auditQueryRuntime";

describe("resolveAuditQuery", () => {
  it("returns the HTTP audit adapter in api mode", async () => {
    const listAuditEvents = vi.fn(async () => ({ items: [], nextCursor: null }));
    const createHttp = vi.fn((): AuditQuery => ({ listAuditEvents }));

    const query = resolveAuditQuery({ mode: "api", createHttp });

    expect(createHttp).toHaveBeenCalledTimes(1);
    await expect(query.listAuditEvents({ projectId: "proj-1", limit: 5 })).resolves.toEqual({
      items: [],
      nextCursor: null
    });
    expect(listAuditEvents).toHaveBeenCalledWith({ projectId: "proj-1", limit: 5 });
  });

  it("returns an injectable mock adapter in mock mode without constructing HTTP", async () => {
    const listAuditEvents = vi.fn(async () => ({ items: [], nextCursor: null }));
    const createMock = vi.fn((): AuditQuery => ({ listAuditEvents }));
    const createHttp = vi.fn((): AuditQuery => ({
      listAuditEvents: vi.fn()
    }));

    const query = resolveAuditQuery({ mode: "mock", createMock, createHttp });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createHttp).not.toHaveBeenCalled();
    await expect(query.listAuditEvents({ limit: 3 })).resolves.toEqual({ items: [], nextCursor: null });
  });
});
