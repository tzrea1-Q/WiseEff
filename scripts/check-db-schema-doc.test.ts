import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const entry = fileURLToPath(new URL("./check-db-schema-doc.ts", import.meta.url));

/** Exercise the actual CLI's exit status with synthetic pg responses. No
 * socket is opened; these cases are not real PostgreSQL/schema evidence. */
function execute(mode: "no-database" | "no-vector" | "render-failure", args: string[], explicitTarget = true) {
  const source = `
    import pg from 'pg';
    pg.Client.prototype.connect = async function () {
      if (${JSON.stringify(mode)} === 'no-database') throw new Error('synthetic-unreachable');
    };
    pg.Client.prototype.end = async function () {};
    pg.Client.prototype.query = async function (sql) {
      if (sql.includes('pg_available_extensions')) return { rows: [], rowCount: ${mode === "no-vector" ? 0 : 1} };
      throw new Error('synthetic-render-failed');
    };
    process.argv = [process.execPath, ${JSON.stringify(entry)}, ...${JSON.stringify(args)}];
    await import(${JSON.stringify(new URL("./check-db-schema-doc.ts", import.meta.url).href)});
  `;
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
    encoding: "utf8", timeout: 10_000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME,
      ...(explicitTarget ? { TEST_DATABASE_URL: "postgres://synthetic@invalid.invalid/synthetic" } : {}) },
  });
}

it.each(["no-database", "no-vector"] as const)("strict CLI refuses the previously successful %s skip", mode => {
  const result = execute(mode, ["--require-database"]);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
});

it.each(["no-database", "no-vector"] as const)("ordinary CLI retains its explicit %s skip", mode => {
  const result = execute(mode, []);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toContain("check skipped:");
});

it("strict mode cannot fall back to an implicit database target", () => {
  const result = execute("no-database", ["--require-database"], false);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("an explicit test database is required");
});

it("rejects an unknown option instead of silently using the ordinary skip contract", () => {
  const result = execute("no-database", ["--require-databse"]);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(2);
});

it("database and vector prechecks cannot substitute for rendering the migrated schema", () => {
  const result = execute("render-failure", ["--require-database"]);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("synthetic-render-failed");
  expect(result.stdout).not.toContain("db-schema artifact is current");
});
