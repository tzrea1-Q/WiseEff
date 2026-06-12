import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { resetQualityRuntime } from "./reset-quality-runtime";
import type { Database, Queryable } from "../server/shared/database/client";

describe("quality runtime reset wiring", () => {
  it("resets transient user-governance state before quality gate seeding", () => {
    const helpers = readFileSync("e2e/quality/helpers.ts", "utf8");

    expect(helpers).toContain("reset:quality-runtime");
    expect(helpers.indexOf('"reset:quality-runtime"')).toBeLessThan(helpers.indexOf('"db:seed:m0"'));
  });

  it("clears transient local-auth and acceptance user-governance rows before seeds rebuild stable users", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const tx: Queryable = {
      async query(text, values = []) {
        queries.push({ text: text.replace(/\s+/g, " ").trim(), values });
        return { rows: [], rowCount: 0 };
      }
    };
    const db: Database = {
      query: tx.query,
      async transaction(callback) {
        return callback(tx);
      }
    };

    await resetQualityRuntime(db);

    expect(queries.map((query) => query.text)).toEqual([
      "update users set organization_id = 'org-chargelab' where id = any($1::text[])",
      "delete from local_registration_role_requests",
      "delete from auth_sessions",
      "delete from user_password_credentials",
      "delete from user_role_bindings",
      "delete from audit_events where app in ('auth', 'user-governance') or target_type = 'user'",
      "delete from users where id <> all($1::text[])"
    ]);
    expect(queries[0].values[0]).toEqual([
      "u-xu-yun",
      "u-zhao-heng",
      "u-liu-min",
      "u-wang-jie",
      "u-chen-na",
      "u-li-peng",
      "u-sun-mei"
    ]);
    expect(JSON.stringify(queries)).not.toContain("u-tao-lin");
  });
});
