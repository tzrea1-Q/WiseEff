import { describe, expect, it } from "vitest";
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
});
