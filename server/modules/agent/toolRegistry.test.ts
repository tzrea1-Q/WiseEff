import { describe, expect, it } from "vitest";
import { developmentAuthContext } from "../auth/routes";
import { ApiError } from "../../shared/http/errors";
import { createAgentToolRegistry } from "./toolRegistry";

describe("agent tool registry", () => {
  it("registers the Xiaoze tool surface with approval classification", () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });

    expect(registry.get("perception.getProjectOverview")?.requiresApproval).toBe(false);
    expect(registry.get("perception.searchParameters")?.permission).toBe("parameter:view");
    expect(registry.get("action.submitParameterChange")?.requiresApproval).toBe(true);
  });

  it("describes Binding source formats and the unsupported delete action", () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });
    const metadata = registry.require("action.submitParameterChange");

    expect(metadata.description).toContain("DTS");
    expect(metadata.description).toContain("JSON");
    expect(metadata.description).toContain("binding id");
    expect(metadata.description).toContain("explicit user approval");
    expect(metadata.description).toContain("Delete is not supported");
    expect(metadata.schema).toMatchObject({
      properties: {
        targetValue: { type: "string", description: expect.stringContaining("DTS") }
      },
      required: ["projectId", "parameterId", "targetValue", "reason"],
      additionalProperties: false
    });
    expect(metadata.schema).toMatchObject({
      properties: { targetValue: { description: expect.stringContaining("JSON") } }
    });
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
      permissions: ["parameter:view" as const]
    };

    await expect(
      registry.run(
        "perception.getProjectOverview",
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
      permissions: ["parameter:view" as const]
    };

    await expect(
      registry.run(
        "perception.getProjectOverview",
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
      permissions: ["parameter:view" as const]
    };

    await expect(
      registry.run(
        "perception.getProjectOverview",
        { auth, requestId: "req-1", sessionId: "agent-session-1" },
        {}
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN", details: { projectId: undefined } });
  });

  it("allows global admin authorization without a project but does not fabricate a trusted parameter read", async () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });
    const context = { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1" };
    const payload = {};
    const authorization = registry.authorize("perception.getProjectOverview", context, payload);
    expect(authorization).toMatchObject({ name: "perception.getProjectOverview", context, payload });

    await expect(
      registry.run(
        "perception.getProjectOverview",
        context,
        payload,
        authorization
      )
    ).rejects.toMatchObject({
      code: "INVALID_TRUSTED_INVOCATION_CONTEXT"
    });
  });
});
