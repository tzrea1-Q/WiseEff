import { describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/core";
import { createXiaozeAgUiHandler } from "./agUiEndpoint";

async function collectSseEvents(response: { sse: AsyncIterable<{ event: string; data: unknown }> }) {
  const events: Array<{ event: string; data: unknown }> = [];
  for await (const event of response.sse) {
    events.push(event);
  }
  return events;
}

describe("createXiaozeAgUiHandler", () => {
  it("rejects unauthenticated AG-UI runs", async () => {
    const handler = createXiaozeAgUiHandler({
      resolveAuth: async () => undefined,
      createAgent: () => ({ run: async () => ({ text: "", citations: [] }) })
    });
    await expect(handler({ headers: {}, body: { messages: [] }, requestId: "req-1" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED"
    });
  });

  it("emits RUN_STARTED and RUN_FINISHED for authenticated runs", async () => {
    const handler = createXiaozeAgUiHandler({
      resolveAuth: async () =>
        ({
          organization: { id: "org1" },
          user: { id: "u1", isActive: true },
          permissions: [],
          roles: []
        }) as never,
      createAgent: () => ({
        run: vi.fn().mockResolvedValue({ text: "Grounded answer with 12 parameters.", citations: [] })
      })
    });

    const response = await handler({
      headers: { authorization: "Bearer test" },
      body: { threadId: "thread-1", runId: "run-1", messages: [{ role: "user", content: "summarize" }] },
      requestId: "req-2"
    });

    expect("sse" in response).toBe(true);
    const events = await collectSseEvents(response as { sse: AsyncIterable<{ event: string; data: unknown }> });
    expect(events[0]?.event).toBe(EventType.RUN_STARTED);
    expect(events.some((event) => event.event === EventType.TEXT_MESSAGE_CONTENT)).toBe(true);
    expect(events.at(-1)?.event).toBe(EventType.RUN_FINISHED);
  });
});
