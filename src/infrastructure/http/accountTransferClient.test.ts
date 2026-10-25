import { expect, it, vi } from "vitest";
import { createApiClient } from "./apiClient";
import { createAccountTransferClient } from "./accountTransferClient";

it("lists only active target organizations and excludes the source", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ items: [
    { id: "source", status: "active" }, { id: "target", status: "active" }, { id: "paused", status: "suspended" }, { id: "deleting", status: "deleting" }
  ].map((item) => ({ ...item, name: item.id, createdAt: "2026-10-24", administrators: [] })) }), { status: 200 }));
  const client = createAccountTransferClient("source", createApiClient({ baseUrl: "http://localhost", fetchImpl: fetcher }));
  expect(await client.listTargets()).toEqual([expect.objectContaining({ id: "target", status: "active" })]);
});
