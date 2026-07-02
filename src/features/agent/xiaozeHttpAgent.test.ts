import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { createAuthenticatedFetch, createXiaozeHttpAgent, resolveXiaozeAuthorizationHeader } from "./xiaozeHttpAgent";

vi.mock("@/infrastructure/auth/oidcAuthProvider", () => ({
  createDefaultOidcAuthProvider: () => ({
    getAuthorization: vi.fn(async () => undefined)
  })
}));

vi.mock("@/infrastructure/http/authClient", () => ({
  readLocalAuthToken: vi.fn(() => "we_local_test_token")
}));

vi.mock("@/infrastructure/http/runtimeMode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/http/runtimeMode")>();
  return {
    ...actual,
    wiseEffApiAuthorization: undefined,
    wiseEffApiBaseUrl: "http://127.0.0.1:8787"
  };
});

describe("xiaozeHttpAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves local session bearer tokens for Xiaoze requests", async () => {
    await expect(resolveXiaozeAuthorizationHeader()).resolves.toBe("Bearer we_local_test_token");
  });

  it("adds Authorization on each fetch call", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const authFetch = createAuthenticatedFetch(fetchImpl);

    await authFetch("http://127.0.0.1:8787/api/v1/agent/xiaoze", { method: "POST" });

    const calls = fetchImpl.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    expect(calls).toHaveLength(1);
    const headers = calls[0]?.[1]?.headers as Headers | undefined;
    expect(headers?.get("Authorization")).toBe("Bearer we_local_test_token");
  });

  it("bridges CopilotKit command resume into AG-UI resume entries before runAgent", async () => {
    const runAgent = vi.spyOn(HttpAgent.prototype, "runAgent").mockResolvedValue({
      result: undefined,
      newMessages: []
    });

    const agent = createXiaozeHttpAgent();
    await agent.runAgent({
      forwardedProps: {
        command: {
          resume: { decision: "approve", editedArgs: { targetValue: "18A" } },
          interruptEvent: { approvalId: "approval-1" }
        }
      }
    });

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        resume: [
          expect.objectContaining({
            interruptId: "approval-1",
            status: "resolved",
            payload: expect.objectContaining({
              approvalId: "approval-1",
              decision: "approve"
            })
          })
        ]
      }),
      undefined
    );

    runAgent.mockRestore();
  });
});
