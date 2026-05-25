import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "./app";
import { requestJson } from "./test/testClient";

describe("WiseEff API", () => {
  it("serves the health endpoint", async () => {
    const response = await requestJson(createWiseEffServer(), "/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, service: "wiseeff-api" });
  });
});
