import { describe, expect, it } from "vitest";
import { developmentAuthContext } from "../auth/routes";
import { ApiError } from "../../shared/http/errors";
import { createAgentToolRegistry } from "./toolRegistry";

describe("agent tool registry", () => {
  it("registers the M4 tool surface with approval classification", () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });

    expect(registry.get("parameter.summarizeReviewQueue")?.requiresApproval).toBe(false);
    expect(registry.get("audit.summarizeRecentEvents")?.permission).toBe("admin:access");
    expect(registry.get("parameter.submitChangeDraft")?.requiresApproval).toBe(true);
  });

  it("rejects unknown tools", async () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });

    expect(() => registry.require("missing.tool")).toThrow(ApiError);
  });

  it("rejects payload project access when it differs from the allowed context project", async () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });
    const auth = {
      ...developmentAuthContext,
      roles: [{ roleId: "hardware-user" as const, projectId: "aurora" }],
      permissions: ["parameter:review" as const]
    };

    await expect(
      registry.run(
        "parameter.summarizeReviewQueue",
        { auth, requestId: "req-1", sessionId: "agent-session-1", projectId: "aurora" },
        { projectId: "zephyr" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN", details: { projectId: "zephyr" } });
  });

  it("rejects payload project access when context project is absent", async () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });
    const auth = {
      ...developmentAuthContext,
      roles: [{ roleId: "hardware-user" as const, projectId: "aurora" }],
      permissions: ["parameter:review" as const]
    };

    await expect(
      registry.run(
        "parameter.summarizeReviewQueue",
        { auth, requestId: "req-1", sessionId: "agent-session-1" },
        { projectId: "zephyr" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN", details: { projectId: "zephyr" } });
  });

  it("rejects project-scoped users when no effective project is provided", async () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });
    const auth = {
      ...developmentAuthContext,
      roles: [{ roleId: "hardware-user" as const, projectId: "aurora" }],
      permissions: ["parameter:review" as const]
    };

    await expect(
      registry.run(
        "parameter.summarizeReviewQueue",
        { auth, requestId: "req-1", sessionId: "agent-session-1" },
        {}
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN", details: { projectId: undefined } });
  });

  it("allows global admin users to run without a project", async () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });

    await expect(
      registry.run(
        "parameter.summarizeReviewQueue",
        { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1" },
        {}
      )
    ).resolves.toMatchObject({
      summary: "0 parameter change requests are waiting in the review queue."
    });
  });
});
