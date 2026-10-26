import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./apiClient";
import { createWorkflowPublicationClient } from "./workflowPublicationClient";

describe("workflow publication HTTP boundary", () => {
  it("preserves a closed workflow and sends the exact optimistic version", async () => {
    const item = { workflows: { "parameter-management": true, debugging: true, "log-analysis": false, knowledge: false }, version: 2, updatedAt: null, updatedBy: null };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ item })));
    const client = createWorkflowPublicationClient(createApiClient({ baseUrl: "http://api", fetchImpl }));
    expect((await client.updatePublication({ workflows: item.workflows, expectedVersion: 1 })).workflows.knowledge).toBe(false);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ workflows: item.workflows, expectedVersion: 1 });
  });
  it("rejects malformed successful responses instead of treating missing or string states as published", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ item: { workflows: { knowledge: "false" }, version: 1 } })));
    const client = createWorkflowPublicationClient(createApiClient({ baseUrl: "http://api", fetchImpl }));
    await expect(client.getPublication()).rejects.toMatchObject({ code: "INTERNAL_ERROR", details: { reason: "contract-drift" } });
  });
});
