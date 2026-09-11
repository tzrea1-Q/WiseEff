import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Database } from "../server/shared/database/client";
import { runParameterDataMode } from "./parameter-data-mode";

const migrations = new URL("../server/migrations/", import.meta.url);
const inventory = await Promise.all((await readdir(migrations)).filter(name => name.endsWith(".sql")).sort().map(async name => ({
  name, checksum: createHash("sha256").update(await readFile(new URL(name, migrations))).digest("hex"),
})));
const sourceSha = "82344044b436a8dafecefbb85dfd724cecb05e3f";

// Unit checks for refusal/observation behavior. A synthetic query result is not
// source-shape acceptance; that positive case requires the actual old database.
function observation(ledger = inventory, counts = { states: "0", releases: "0", subjects: "0", definitions: "0" }) {
  const sql: string[] = [];
  const db: Database = {
    async query<Row>(text: string) {
      sql.push(text);
      const rows = text.includes("from schema_migrations") ? ledger
        : text.includes("count(*) from parameter_catalog.catalog_state") ? [counts] : [];
      return { rows: rows as Row[], rowCount: rows.length };
    },
    transaction: async work => work(db),
  };
  return { db, sql };
}

describe("new-empty management observation", () => {
  it("observes unpublished state repeatedly without initializing or deleting data", async () => {
    const { db, sql } = observation();
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(await runParameterDataMode(db, { phase: "initialize", sourceSha })).toMatchObject({ state: "canonical-unpublished" });
    }
    expect(sql.every(text => /^select\b|^set transaction\b/.test(text))).toBe(true);
    expect(sql.filter(text => text === "set transaction isolation level repeatable read, read only")).toHaveLength(2);
  });

  it("rejects a changed historical checksum without repairing the ledger", async () => {
    const { db, sql } = observation(inventory.map((row, i) => i === 0 ? { ...row, checksum: "changed" } : row));
    await expect(runParameterDataMode(db, { phase: "inspect", sourceSha })).rejects.toThrow("ledger-unknown-or-drifted");
    expect(sql).toHaveLength(2);
  });

  it("rejects a different old source before schema preparation", async () => {
    const { db, sql } = observation(inventory.filter(row => row.name < "0129_"));
    await expect(runParameterDataMode(db, { phase: "prepare", sourceSha: "a".repeat(40) })).rejects.toThrow("source-sha-unsupported");
    expect(sql.some(text => /create|alter|insert|delete|update/i.test(text))).toBe(false);
  });

  it("rejects a partial migration instead of treating existing tables as completion", async () => {
    const { db } = observation(inventory.slice(0, -1));
    await expect(runParameterDataMode(db, { phase: "initialize", sourceSha })).rejects.toThrow("partial-migration");
  });

  it("does not treat an orphan publication as an empty catalog", async () => {
    const { db } = observation(inventory, { states: "0", releases: "1", subjects: "0", definitions: "0" });
    await expect(runParameterDataMode(db, { phase: "initialize", sourceSha })).rejects.toThrow("partial-catalog");
  });
});
