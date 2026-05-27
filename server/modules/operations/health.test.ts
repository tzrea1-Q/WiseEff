import { describe, expect, it } from "vitest";

import type { Queryable } from "../../shared/database/client";
import { buildLiveHealth, buildReadyHealth } from "./health";

describe("operations health", () => {
  it("reports liveness without checking dependencies", () => {
    expect(buildLiveHealth()).toMatchObject({
      ok: true,
      service: "wiseeff-api",
      status: "live"
    });
  });

  it("reports ready when database dependency passes", async () => {
    const db: Pick<Queryable, "query"> = {
      query: async <Row,>() => ({ rows: [{ ok: 1 } as Row], rowCount: 1 })
    };

    await expect(buildReadyHealth({ db })).resolves.toMatchObject({
      status: 200,
      body: {
        ok: true,
        service: "wiseeff-api",
        status: "ready",
        dependencies: {
          database: { ok: true, status: "ready" }
        }
      }
    });
  });

  it("returns 503 with actionable dependency status when database is missing", async () => {
    await expect(buildReadyHealth({})).resolves.toMatchObject({
      status: 503,
      body: {
        ok: false,
        service: "wiseeff-api",
        status: "not_ready",
        dependencies: {
          database: {
            ok: false,
            status: "missing",
            message: "DATABASE_URL is not configured for this API process."
          }
        }
      }
    });
  });
});
