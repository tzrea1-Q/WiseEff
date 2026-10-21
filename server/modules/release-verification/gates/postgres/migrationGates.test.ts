import { describe, expect, it } from "vitest";
import type { GateQuery } from "./session";
import type { PackagedMigrationInventory } from "./inventory";
import { runM02, runM03 } from "./migrationGates";

const supersededMigration = "0214_parameter_definition_purge_scope.sql";
const replacementMigration = "0220_parameter_definition_purge_compatibility.sql";
const packagedNames = [
  "0213_parameter_definition_purge.sql",
  supersededMigration,
  "0215_definition_erasure_source_fences.sql",
  "0219_definition_erasure_private_trigger_capability.sql",
  replacementMigration,
];
const inventory: PackagedMigrationInventory = {
  dir: "migration-gate-unit-fixture",
  entries: packagedNames.map(name => ({ name, checksum: `checksum:${name}` })),
  digest: "sha256:unit-migration-inventory",
  lastName: replacementMigration,
  schemaVersionPrefix: "0220",
};

function queryFor(names: string[], changedChecksum?: string): GateQuery {
  const rows = names.slice().sort().map(name => ({
    name, checksum: name === changedChecksum ? "changed" : `checksum:${name}`,
  }));
  return async <Row>() => ({ rows: rows as Row[], rowCount: rows.length });
}

describe("migration verification with a checksum-preserving replacement", () => {
  it.each<[string, string[]]>([
    ["before the superseded migration", [packagedNames[0]!]],
    ["after replacement and before its following migrations", [packagedNames[0]!, replacementMigration]],
    ["after completing the replacement path", packagedNames.filter(name => name !== supersededMigration)],
    ["after completing the original path", packagedNames],
  ])("accepts a contiguous execution history %s", async (_description, applied) => {
    expect((await runM03(queryFor(applied), inventory)).status).toBe("passed");
  });

  it("rejects a hole among migrations following the replacement", async () => {
    const applied = [packagedNames[0]!, packagedNames[3]!, replacementMigration];

    expect((await runM03(queryFor(applied), inventory)).status).toBe("failed");
  });

  it("requires the replacement to be packaged before omitting the original", async () => {
    const withoutReplacement = { ...inventory, entries: inventory.entries.filter(row => row.name !== replacementMigration) };
    const applied = packagedNames.filter(name => name !== supersededMigration && name !== replacementMigration);

    expect((await runM03(queryFor(applied), withoutReplacement)).status).toBe("failed");
  });

  it("continues rejecting unrecognized historical entries", async () => {
    const applied = [...packagedNames.filter(name => name !== supersededMigration), "9999_unknown.sql"];

    expect((await runM03(queryFor(applied), inventory)).status).toBe("failed");
  });

  it.each([supersededMigration, replacementMigration])("rejects a changed checksum for applied %s", async name => {
    expect((await runM02(queryFor(packagedNames, name), inventory)).status).toBe("failed");
  });
});
