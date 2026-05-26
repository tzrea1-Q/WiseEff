import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("M1 parameter migration invariants", () => {
  it("enforces one history entry per project parameter value version", () => {
    const migration = readFileSync(path.join(root, "server", "migrations", "0002_m1_parameters.sql"), "utf8");

    expect(migration).toContain("parameter_history_entries_value_version_unique_idx");
    expect(migration).toContain("on parameter_history_entries(project_parameter_value_id, version)");
  });
});
