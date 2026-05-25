import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "./app";
import { createHttpServer } from "./shared/http/server";
import { requestJson } from "./test/testClient";

describe("WiseEff API", () => {
  it("serves the health endpoint", async () => {
    const response = await requestJson(createWiseEffServer(), "/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, service: "wiseeff-api" });
  });

  it("parses query strings with repeated params", async () => {
    const server = createHttpServer({
      handle: async (request) => ({
        status: 200,
        body: {
          risk: request.query.risk,
          q: request.query.q
        }
      })
    });

    const response = await requestJson(server, "/api/v1/search?risk=High&risk=Low&q=thermal");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ risk: ["High", "Low"], q: "thermal" });
  });
});
