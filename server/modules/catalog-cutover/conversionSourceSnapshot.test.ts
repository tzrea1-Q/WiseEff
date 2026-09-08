import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { captureConversionSourceInventory, captureConversionSourceSnapshot } from "./conversionManifest";
import type { CutoverQueryable } from "./checkpoints";

const names = ["parameter_specs", "parameter_spec_versions", "driver_schemas", "driver_schema_versions",
  "dts_property_specs", "attribution_subjects", "parameter_modules", "driver_registration_placements", "parameter_module_mappings"];
function fixture() {
  const tables = [...names, "users"].sort().map(table_name => ({ table_name,
    columns: table_name === "driver_schema_versions" ? ["id", "source", "value"] : ["id", "value"] }));
  const records: Record<string, Array<{ source_row: Record<string, unknown>; sql_nulls: boolean[] }>> =
    Object.fromEntries(tables.map(table => [table.table_name, []]));
  records.driver_schema_versions = [
    { source_row: { id: "source-column", source: "manual", value: "row" }, sql_nulls: [false, false, false] },
  ];
  records.parameter_spec_versions = [
    { source_row: { id: "sql-null", value: null }, sql_nulls: [false, true] },
    { source_row: { id: "json-null", value: null }, sql_nulls: [false, false] },
    { source_row: { id: "empty", value: "" }, sql_nulls: [false, false] },
  ];
  records.users = [{ source_row: { id: "private-user", value: "private-password-canary" }, sql_nulls: [false, false] }];
  const queries: string[] = [];
  const faults = { restore: false, preparation: "" };
  const client = { async query(sql: string) {
    queries.push(sql);
    if (sql === faults.preparation) throw new Error("postgres://private-canary:password@private-host/raw-input", { cause: "private-cause" });
    if (sql === "set row_security = on" && faults.restore) throw new Error("private-cleanup-canary");
    if (sql === "show row_security") return { rows: [{ row_security: "on" }] };
    if (sql.startsWith("set row_security")) return { rows: [] };
    if (sql.includes("pg_catalog.pg_class")) return { rows: structuredClone(tables) };
    const relation = /from public\."([a-z_]+)" source_record/.exec(sql)?.[1];
    if (!relation) throw new Error("unexpected-query-double");
    return { rows: structuredClone(records[relation]) };
  } } as CutoverQueryable;
  return { client, queries, records, tables, faults };
}

describe("conversion source projection from the original complete-row scan", () => {
  it("keeps the original digest bytes and exposes only the closed source families", async () => {
    const f = fixture(), hash = createHash("sha256");
    for (const table of f.tables) hash.update(JSON.stringify({ table: table.table_name, columns: table.columns,
      rows: f.records[table.table_name]!.map(row => JSON.stringify(row)).sort() }));
    const expected = `sha256:${hash.digest("hex")}`;
    expect(await captureConversionSourceInventory(f.client)).toBe(expected);
    const snapshot = await captureConversionSourceSnapshot(f.client);
    expect(snapshot.sourceInventoryFingerprint).toBe(expected);
    expect(snapshot.records.map(row => [row.sourceId, row.payload.value, row.sqlNullColumns])).toEqual([
      ["source-column", "row", []],
      ["empty", "", []], ["json-null", null, []], ["sql-null", null, ["value"]],
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("private-password-canary");
    expect(f.queries.filter(sql => sql.startsWith("select to_jsonb"))).toHaveLength(f.tables.length * 2);
    expect(f.queries.at(-1)).toBe("set row_security = on");
  });
  it("refuses a missing source relation without changing the historical digest-only reader", async () => {
    const f = fixture(); f.tables.splice(f.tables.findIndex(table => table.table_name === "parameter_specs"), 1);
    await expect(captureConversionSourceSnapshot(f.client)).rejects.toThrow("PROJECTION-INCOMPLETE");
    await expect(captureConversionSourceInventory(f.client)).resolves.toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(f.queries.at(-1)).toBe("set row_security = on");
  });
  it.each(["flags", "duplicate"])("refuses malformed %s without projecting guessed data", async mode => {
    const f = fixture();
    if (mode === "flags") f.records.parameter_spec_versions![0]!.sql_nulls.pop();
    else f.records.parameter_spec_versions!.push(structuredClone(f.records.parameter_spec_versions![0]!));
    await expect(captureConversionSourceSnapshot(f.client)).rejects.toThrow("PCAT-CONVERSION-SOURCE-PROJECTION-");
    expect(f.queries.at(-1)).toBe("set row_security = on");
  });
  it("retains the closed primary projection refusal when restoring the session also fails", async () => {
    const f = fixture(); f.records.parameter_spec_versions![0]!.sql_nulls.pop(); f.faults.restore = true;
    const failure = await captureConversionSourceSnapshot(f.client).catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors.map((error: Error) => error.message)).toEqual([
      "PCAT-CONVERSION-SOURCE-PROJECTION-INVALID", "PCAT-CONVERSION-SOURCE-PROJECTION-RESTORE-FAILED",
    ]);
    expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure))).not.toContain("private-cleanup-canary");
  });
  it("refuses an otherwise complete projection if restoring the session fails", async () => {
    const f = fixture(); f.faults.restore = true;
    await expect(captureConversionSourceSnapshot(f.client)).rejects.toThrow("PCAT-CONVERSION-SOURCE-PROJECTION-RESTORE-FAILED");
  });
  it.each(["show row_security", "set row_security = off"])("sanitizes the first %s failure before exposing a projection", async stage => {
    const f = fixture(); f.faults.preparation = stage;
    const failure = await captureConversionSourceSnapshot(f.client).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe("PCAT-CONVERSION-SOURCE-PROJECTION-QUERY-FAILED");
    expect(failure.cause).toBeUndefined();
    expect(String(failure.stack)).not.toContain("private-canary");
    expect(f.queries.at(-1)).toBe(stage);
    expect(f.queries.some(query => query.includes("pg_catalog.pg_class"))).toBe(false);
  });
});
