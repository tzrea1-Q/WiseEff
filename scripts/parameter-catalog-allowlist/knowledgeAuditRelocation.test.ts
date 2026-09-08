import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import { scanParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import { applyReviewedExactRelocation, validateExactRelocation } from "./exactRelocation";

const root = process.cwd();
const record = JSON.parse(await readFile(`${root}/scripts/fixtures/parameter-catalog-allowlist/knowledge-audit-relocation.json`, "utf8"));
const fixture = await loadBoundaryViolationFixture(root);
const allowances = (await loadAllowlistIndex(root)).entries;
const source = execFileSync("git", ["show", `${record.trustedBaseSha}:${record.file}`]);
const destination = await readFile(`${root}/${record.file}`);
let discovered: Awaited<ReturnType<typeof scanParameterCatalogBoundaries>>;
beforeAll(async () => { discovered = await scanParameterCatalogBoundaries(root, fixture.trustedBaseSha); }, 60_000);
const input = () => ({ fixture, allowances, source, destination, discovered });

it("maps only the three approved natural audit relocations while retaining the separate 23-pair record", async () => {
  expect(validateExactRelocation(record, input())).toHaveLength(3);
  const result = await applyReviewedExactRelocation(root, fixture, allowances, discovered);
  expect(result.relocations).toHaveLength(26);
  expect(result.relocations.filter(pair => pair.observed.file === record.file)).toHaveLength(3);
  expect(fixture.violations).toHaveLength(3519);
  expect(allowances).toHaveLength(3509);
});

it.each(["fourth pair", "missing pair", "duplicate", "blob", "position", "slice", "permission", "source identity", "target identity"])("rejects %s beyond D-A", change => {
  const altered = structuredClone(record);
  if (change === "fourth pair") altered.pairs.push(structuredClone(altered.pairs[0]));
  if (change === "missing pair") altered.pairs.pop();
  if (change === "duplicate") altered.pairs[1] = structuredClone(altered.pairs[0]);
  if (change === "blob") altered.destinationBlobOid = "0".repeat(40);
  if (change === "position") altered.pairs[0].new.byteStart++;
  if (change === "slice") altered.pairs[0].sliceSha256 = "0".repeat(64);
  if (change === "permission") altered.pairs[0].new.reason += " altered";
  if (change === "source identity") altered.pairs[0].old.id = altered.pairs[1].old.id;
  if (change === "target identity") altered.pairs[0].new.id = altered.pairs[1].new.id;
  expect(() => validateExactRelocation(altered, input())).toThrow();
});

it.each(["source", "destination"] as const)("rejects future %s bytes even outside protected slices", side => {
  const values = input();
  values[side] = Buffer.concat([values[side], Buffer.from("\n")]);
  expect(() => validateExactRelocation(record, values)).toThrow();
});
