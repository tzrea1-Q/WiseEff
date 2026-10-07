import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baselinePath, runCli } from "./check-parameter-catalog-boundaries";
import { consumerShardDefinitions } from "./parameter-catalog-boundaries/families";
import { scanSourceFile } from "./parameter-catalog-boundaries/scan";

const consumerFile = "server/modules/parameters/baseline-test.ts";
const rawRead = 'db.query("SELECT * FROM parameter_specs");';
let root: string;
let output: string[];

async function writeSource(file: string, contents: string) {
  const path = resolve(root, file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function check(...args: string[]) {
  output = [];
  return runCli(args, root, (message) => output.push(message));
}

async function baseline() {
  return JSON.parse(await readFile(resolve(root, baselinePath), "utf8"));
}

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "catalog-boundary-baseline-"));
  for (const definition of consumerShardDefinitions) {
    for (const path of definition.paths) {
      if (!path.required) continue;
      if (path.pattern.endsWith("/**")) await mkdir(resolve(root, path.pattern.slice(0, -3)), { recursive: true });
      else await writeSource(path.pattern, "");
    }
  }
  await writeSource(consumerFile, rawRead);
  await check("--update", "--allow-increase");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Parameter Catalog count baseline CLI", () => {
  it("passes equal counts with a one-line summary", async () => {
    expect(await check()).toBe(0);
    expect(output).toEqual(["Parameter Catalog boundary baseline: 1 occurrences, 1 files."]);
    await writeSource(consumerFile, `\n${rawRead}`);
    expect(await check()).toBe(0);
  });

  it("fails growth in an existing file with rule, counts, and evidence", async () => {
    await writeSource(consumerFile, `${rawRead}\n${rawRead}`);
    expect(await check()).toBe(1);
    expect(output[0]).toContain(`${consumerFile} legacy-catalog-raw-read baseline=1 actual=2`);
    expect(output).toContain(`  ${consumerFile}:1 read parameter_specs: SELECT * FROM parameter_specs`);
    expect(output).toContain(`  ${consumerFile}:2 read parameter_specs: SELECT * FROM parameter_specs`);
  });

  it("fails a violation in a new file", async () => {
    await writeSource("server/modules/parameters/new.ts", rawRead);
    expect(await check()).toBe(1);
    expect(output.join("\n")).toContain("new.ts legacy-catalog-raw-read baseline=0 actual=1");
  });

  it("fails a new rule even when the file total stays equal", async () => {
    await writeSource(consumerFile, 'import "../parameter-specs/repository";');
    expect(await check()).toBe(1);
    expect(output.join("\n")).toContain("legacy-catalog-module-import baseline=0 actual=1");
  });

  it("reports a decrease as stale and gives the update command", async () => {
    await writeSource(consumerFile, "");
    expect(await check()).toBe(1);
    expect(output[0]).toContain("Stale baseline:");
    expect(output[0]).toContain("baseline=1 actual=0");
    expect(output[1]).toContain("npm run parameter-catalog-boundaries:check -- --update");
  });

  it("reports deleted files as stale", async () => {
    await rm(resolve(root, consumerFile));
    expect(await check()).toBe(1);
    expect(output[0]).toContain(`${consumerFile} legacy-catalog-raw-read baseline=1 actual=0`);
  });

  it("updates lower counts and omits zero-count files", async () => {
    await writeSource(consumerFile, "");
    expect(await check("--update")).toBe(0);
    expect(await baseline()).toEqual({ schemaVersion: 1, counts: {} });
    expect(await check()).toBe(0);
  });

  it("refuses increases without writing, including mixed decreases", async () => {
    const previous = await readFile(resolve(root, baselinePath), "utf8");
    await writeSource(consumerFile, "");
    await writeSource("server/modules/parameters/new.ts", rawRead);
    expect(await check("--update")).toBe(1);
    expect(output.join("\n")).toContain("Baseline update refused");
    expect(await readFile(resolve(root, baselinePath), "utf8")).toBe(previous);
  });

  it("allows an explicit increase and writes sorted keys", async () => {
    await writeSource(consumerFile, `${rawRead}\nconst parameterSpecId = 1;`);
    await writeSource("server/modules/parameters/aaa.ts", rawRead);
    expect(await check("--update", "--allow-increase")).toBe(0);
    const current = await baseline();
    expect(Object.keys(current.counts)).toEqual(["server/modules/parameters/aaa.ts", consumerFile]);
    expect(Object.keys(current.counts[consumerFile])).toEqual(["legacy-catalog-raw-read", "legacy-parameter-spec-identifier"]);
    expect(await check()).toBe(0);
  });

  it("rejects invalid arguments and malformed baselines", async () => {
    await expect(check("--allow-increase")).rejects.toThrow("requires --update");
    await expect(check("--unknown")).rejects.toThrow("Unknown argument");
    await writeSource(baselinePath, '{"schemaVersion":1,"counts":{"file.ts":{"unknown-rule":1}}}');
    await expect(check("--update", "--allow-increase")).rejects.toThrow();
  });

  it("fails closed when a required consumer root disappears", async () => {
    await rm(resolve(root, "server/modules/parameters"), { recursive: true });
    await expect(check()).rejects.toThrow("Required parameter-catalog consumer path is missing");
  });
});

describe("unchanged boundary detectors", () => {
  it.each([
    ['db.query("UPDATE parameter_specs SET name = $1", values);', "legacy-catalog-sql-write"],
    [rawRead, "legacy-catalog-raw-read"],
    ['import { load } from "../parameter-specs/repository";', "legacy-catalog-module-import"],
    ["db.query(buildSql());", "unresolved-boundary-expression"],
  ])("detects %s", (source, rule) => {
    expect(scanSourceFile("S12-PRJ", consumerFile, source).map((entry) => entry.rule)).toContain(rule);
  });

  it("resolves constant database, route, and module-loader aliases", () => {
    const source = [
      'const sql = "SELECT * FROM parameter_specs";',
      "const client = db; client.query(sql);",
      'const route = "/api/v2/parameter-specs";',
      "const register = router.get; register(route, handler);",
      'const modulePath = "../parameter-specs/repository";',
      "const load = require; load(modulePath);",
    ].join("\n");
    expect(scanSourceFile("S12-PRJ", consumerFile, source).map((entry) => entry.rule)).toEqual(expect.arrayContaining([
      "legacy-catalog-raw-read", "legacy-catalog-route", "legacy-catalog-module-import",
    ]));
  });
});
