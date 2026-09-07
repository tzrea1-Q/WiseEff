import { describe, expect, it } from "vitest";
import { compareLedger, gitMigrationInventory, SOURCE_SHA } from "./inspect-populated-upgrade-source";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = [{ name: "0001.sql", checksum: "a" }];
const candidate = [...source, { name: "0002.sql", checksum: "b" }, { name: "0003.sql", checksum: "c" }];
describe("source inventory rejects guessed compatibility", () => {
  it("lists the complete pending suffix and accepts a committed prefix", () => {
    expect(compareLedger(source, candidate, source)).toEqual({ blockers: [], pending: candidate.slice(1) });
    expect(compareLedger(source, candidate, candidate.slice(0, 2))).toEqual({ blockers: [], pending: candidate.slice(2) });
  });
  it.each([
    [[{ name: "0001.sql", checksum: null }], "checksum-drift:0001.sql"],
    [[{ name: "0001.sql", checksum: "wrong" }], "checksum-drift:0001.sql"],
    [[...source, candidate[2]], "non-prefix-ledger"],
    [[...source, { name: "unknown.sql", checksum: "a" }], "unknown-ledger-name:unknown.sql"],
    [[...source, { name: "0121_classify_nodename_driver_subjects.sql", checksum: "a" }], "unsafe-historical-migration"],
    [[], "source-migration-missing:0001.sql"],
  ] as const)("rejects incompatible ledger %#", (ledger, reason) => {
    expect(compareLedger(source, candidate, [...ledger])).toMatchObject({ blockers: expect.arrayContaining([reason]) });
  });
  it("never rewrites immutable source history", () => {
    expect(compareLedger(source, [{ ...source[0], checksum: "changed" }], source).blockers).toContain("source-migration-mutated:0001.sql");
  });
  it("uses actual source git bytes and preserves legal 0121 identity", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const actual = gitMigrationInventory(root, SOURCE_SHA);
    expect(actual.at(-1)?.name).toBe("0128_repair_driver_placement_subject_cutover.sql");
    expect(actual.some((entry) => entry.name.startsWith("0121_"))).toBe(true);
    expect(actual.some((entry) => entry.name === "0121_classify_nodename_driver_subjects.sql")).toBe(false);
    expect(compareLedger(actual, actual, actual).blockers).toEqual([]);
  });
});
