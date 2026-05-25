import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "./app";
import type { Database, QueryResult } from "./shared/database/client";
import { createHttpServer } from "./shared/http/server";
import { requestJson } from "./test/testClient";

type QueryCall = {
  text: string;
  values: unknown[];
};

function createAuthBoundaryDb() {
  const calls: QueryCall[] = [];
  const db: Database = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      calls.push({ text, values });

      if (text.includes("from users")) {
        return {
          rows: [
            {
              user_id: "user-no-parameter-view",
              organization_id: "org-1",
              organization_name: "ChargeLab",
              name: "No View User",
              email: "noview@example.com",
              title: "No View",
              is_active: true,
              project_id: null,
              role_id: "no-parameter-view"
            }
          ] as Row[],
          rowCount: 1
        };
      }

      if (text.includes("from projects")) {
        return {
          rows: [{ id: "aurora", name: "Aurora", code: "AUR" }] as Row[],
          rowCount: 1
        };
      }

      return { rows: [], rowCount: 0 };
    },
    transaction: async (fn) => fn(db)
  };

  return { calls, db };
}

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

  it("uses request auth context for integrated parameter routes", async () => {
    const { calls, db } = createAuthBoundaryDb();

    const response = await requestJson<{ error: { code: string; message: string } }>(
      createWiseEffServer({ db }),
      "/api/v1/projects",
      {
        headers: { "X-WiseEff-User": "user-no-parameter-view" }
      }
    );

    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({
      code: "FORBIDDEN",
      message: "Parameter view permission is required."
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("from users");
    expect(calls[0].values).toEqual(["user-no-parameter-view"]);
  });
});
