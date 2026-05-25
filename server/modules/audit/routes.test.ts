import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";

describe("audit routes", () => {
  it("rejects audit creation without a database adapter", async () => {
    const response = await requestJson<{ error: { code: string } }>(createWiseEffServer(), "/api/v1/audit-events", {
      method: "POST",
      body: JSON.stringify({
        app: "parameter-admin",
        kind: "export",
        action: "Exported parameter snapshot",
        severity: "Low",
        metadata: {}
      })
    });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
  });
});
