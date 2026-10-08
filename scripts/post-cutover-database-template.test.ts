import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  databases: new Map<string, { marker?: string; owned: boolean }>(),
  locks: new Map<string, Promise<void>>(),
  queries: [] as string[],
  contents: "original-migrations",
  changedDirectory: "",
  failClone: false,
  failDrop: false,
}));

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(async () => [{ name: "0001.sql", isDirectory: () => false, isFile: () => true }]),
  readFile: vi.fn(async (filename: string) => Buffer.from(filename.includes(state.changedDirectory) ? state.contents : "original-migrations")),
}));

vi.mock("pg", () => ({
  default: {
    Client: class {
      releaseLocks = new Map<string, () => void>();
      async connect() {}
      async end() { for (const release of this.releaseLocks.values()) release(); }
      async query(text: string, values: unknown[] = []) {
        state.queries.push(text);
        if (text.includes("pg_advisory_lock")) {
          const key = values.length ? String(values[0]) : "4201659";
          const previous = state.locks.get(key);
          const next = new Promise<void>((resolve) => { this.releaseLocks.set(key, resolve); });
          state.locks.set(key, next);
          await previous;
        } else if (text.includes("pg_advisory_unlock")) {
          this.releaseLocks.get("4201659")?.();
          this.releaseLocks.delete("4201659");
        } else if (text.startsWith("create database")) {
          const databaseName = text.split(" ")[2]!;
          if (state.databases.has(databaseName)) throw new Error("database already exists");
          if (state.failClone && databaseName.startsWith("wiseeff_acceptance_disposable_")) throw new Error("clone failed");
          state.databases.set(databaseName, { owned: true });
        } else if (text.startsWith("comment on database")) {
          const databaseName = text.split(" ")[3]!;
          state.databases.get(databaseName)!.marker = text.slice(text.indexOf(" is '") + 5, -1).replaceAll("''", "'");
        } else if (text.startsWith("drop database")) {
          if (state.failDrop) throw new Error("database is in use");
          state.databases.delete(text.split(" ")[2]!);
        } else if (text.includes("shobj_description") && values.length) {
          const database = state.databases.get(String(values[0]));
          return { rows: database ? [{ marker: database.marker ?? null, owned: database.owned }] : [] };
        } else if (text.startsWith("select 1 from pg_database")) {
          return { rows: state.databases.has(String(values[0])) ? [{}] : [] };
        } else if (text.includes("shobj_description")) {
          return { rows: [...state.databases].filter(([name]) => name.startsWith("wiseeff_acceptance_template_")).map(([name, database]) => ({ database_name: name, marker: database.marker ?? null })) };
        }
        return { rows: [], rowCount: 0 };
      }
    },
  },
}));

import {
  clonePostCutoverDatabase,
  cleanupLocalPostCutoverDatabaseTemplates,
  cleanupPostCutoverDatabaseTemplates,
  postCutoverTemplateFingerprint,
} from "../e2e/acceptance/helpers/postCutoverDatabaseTemplate";
import {
  initializeNestedRuntimeManifest,
  OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV,
  readNestedRuntimeManifest,
  recordNestedDatabaseTemplate,
} from "../e2e/acceptance/helpers/nestedRuntimeManifest";
import { assertNestedDatabaseTemplatesCleanedForSuccess } from "./owned-local-acceptance-runtime";
import lifecycle from "../e2e/acceptance/helpers/postCutoverTemplateLifecycle";

const baseDatabaseUrl = "postgres://owner:password@127.0.0.1:55438/l4_seeded";
const roots: string[] = [];
let sequence = 0;
function clone(catalog?: "fixture-owned", prepare = vi.fn(async () => "deterministic-cutover-run")) {
  return clonePostCutoverDatabase({
    baseDatabaseUrl,
    databaseName: `wiseeff_acceptance_disposable_template_test_${sequence++}`,
    catalog,
    prepare,
  });
}

function ownedManifest() {
  const temporaryRoot = path.join(process.cwd(), ".tmp");
  mkdirSync(temporaryRoot, { recursive: true });
  const root = mkdtempSync(path.join(temporaryRoot, "l4-template-test-"));
  roots.push(root);
  const manifestPath = path.join(root, "nested-runtime-manifest.json");
  initializeNestedRuntimeManifest(manifestPath, { parentRunId: `template-run-${sequence++}`, sourceCommit: "0".repeat(40) });
  vi.stubEnv(OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV, manifestPath);
  return manifestPath;
}

afterEach(() => {
  state.databases.clear();
  state.locks.clear();
  state.queries.length = 0;
  state.contents = "original-migrations";
  state.changedDirectory = "";
  state.failClone = false;
  state.failDrop = false;
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("post-cutover database templates", () => {
  it("migrates once for simultaneous and subsequent clones under the admin lock", async () => {
    const prepare = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "deterministic-cutover-run";
    });
    expect(await Promise.all([clone(undefined, prepare), clone(undefined, prepare)])).toEqual(["deterministic-cutover-run", "deterministic-cutover-run"]);
    await clone(undefined, prepare);
    expect(prepare).toHaveBeenCalledOnce();
    expect(state.queries.filter((query) => query.startsWith("create database wiseeff_acceptance_template_"))).toHaveLength(1);
    expect(state.queries.filter((query) => query.startsWith("create database wiseeff_acceptance_disposable_") && query.includes(" template wiseeff_acceptance_template_"))).toHaveLength(3);
    expect(state.queries.filter((query) => query.includes("pg_advisory_lock($1"))).toHaveLength(3);
    expect(state.queries.filter((query) => query === "select pg_advisory_lock(4201659)")).toHaveLength(1);
  });

  it("keeps seeded and fixture-owned Catalog templates separate", async () => {
    const prepare = vi.fn(async () => "deterministic-cutover-run");
    await clone(undefined, prepare);
    await clone("fixture-owned", prepare);
    await clone("fixture-owned", prepare);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(state.databases.size).toBe(5);
  });

  it("fingerprints content rather than timestamps and provisions a new owned template on drift", async () => {
    const manifestPath = ownedManifest();
    const original = await postCutoverTemplateFingerprint();
    const prepare = vi.fn(async () => "deterministic-cutover-run");
    await clone(undefined, prepare);
    state.contents = "changed-migrations";
    expect(await postCutoverTemplateFingerprint()).not.toBe(original);
    await clone(undefined, prepare);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(readNestedRuntimeManifest(manifestPath).databaseTemplates).toHaveLength(2);
    await cleanupPostCutoverDatabaseTemplates(baseDatabaseUrl, manifestPath);
    expect(() => assertNestedDatabaseTemplatesCleanedForSuccess(manifestPath)).not.toThrow();
  });

  it("verifies the durable fingerprint before reuse and rebuilds a stale same-name template", async () => {
    const prepare = vi.fn(async () => "deterministic-cutover-run");
    await clone(undefined, prepare);
    const template = [...state.databases].find(([name]) => name.startsWith("wiseeff_acceptance_template_"))![1];
    template.marker = JSON.stringify({ ...JSON.parse(template.marker!), fingerprint: "f".repeat(64) });
    await clone(undefined, prepare);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(state.queries.filter((query) => query.startsWith("drop database"))).toHaveLength(1);
  });

  it.each(["server/cutovers", "schemas/dts", "server/modules/catalog-kernel"])("invalidates preparation when %s changes", async (directory) => {
    const fingerprint = await postCutoverTemplateFingerprint();
    state.changedDirectory = directory;
    state.contents = "changed-preparation-input";
    expect(await postCutoverTemplateFingerprint()).not.toBe(fingerprint);
  });

  it.each(["comment", "owner"])("refuses a foreign template %s without dropping it", async (boundary) => {
    await clone();
    const template = [...state.databases].find(([name]) => name.startsWith("wiseeff_acceptance_template_"))![1];
    if (boundary === "comment") template.marker = "foreign";
    else template.owned = false;
    await expect(clone()).rejects.toThrow(/foreign database template/i);
    expect(state.queries.some((query) => query.startsWith("drop database"))).toBe(false);
  });

  it("records intent before preparation and removes only its own failed template", async () => {
    const manifestPath = ownedManifest();
    await expect(clone(undefined, vi.fn(async () => {
      expect(readNestedRuntimeManifest(manifestPath).databaseTemplates?.[0]?.state).toBe("provisioning");
      throw new Error("preparation failed");
    }))).rejects.toThrow("preparation failed");
    expect(state.databases.size).toBe(0);
    expect(readNestedRuntimeManifest(manifestPath).databaseTemplates?.[0]?.state).toBe("removed");
  });

  it("retains an owned template and its durable record after clone failure", async () => {
    const manifestPath = ownedManifest();
    state.failClone = true;
    await expect(clone()).rejects.toThrow("clone failed");
    expect(state.databases.size).toBe(1);
    expect(readNestedRuntimeManifest(manifestPath).databaseTemplates?.[0]?.state).toBe("ready");
  });

  it("requires exact cleanup and does not publish removed when PostgreSQL refuses the drop", async () => {
    const manifestPath = ownedManifest();
    await clone();
    expect(() => assertNestedDatabaseTemplatesCleanedForSuccess(manifestPath)).toThrow(/not clean/i);
    state.failDrop = true;
    await expect(cleanupPostCutoverDatabaseTemplates(baseDatabaseUrl, manifestPath)).rejects.toThrow("database is in use");
    expect(readNestedRuntimeManifest(manifestPath).databaseTemplates?.[0]?.state).toBe("ready");
    state.failDrop = false;
    await cleanupPostCutoverDatabaseTemplates(baseDatabaseUrl, manifestPath);
    expect(() => assertNestedDatabaseTemplatesCleanedForSuccess(manifestPath)).not.toThrow();
    expect(state.databases.size).toBe(1);
  });

  it("rejects a forged manifest template name before any destructive query", () => {
    const manifestPath = ownedManifest();
    expect(() => recordNestedDatabaseTemplate(manifestPath, {
      databaseName: "l4_seeded", templateKey: "a".repeat(64), fingerprint: "b".repeat(64), state: "ready",
    })).toThrow(/inventory is invalid/i);
    expect(state.queries).toEqual([]);
  });

  it("cleans standalone worker templates without touching other run or runtime databases", async () => {
    await clone();
    state.databases.set("wiseeff_acceptance_template_foreign", { owned: true, marker: JSON.stringify({ kind: "wiseeff-post-cutover-template", ownerRunId: "other-run" }) });
    await cleanupLocalPostCutoverDatabaseTemplates(baseDatabaseUrl);
    expect([...state.databases.keys()].sort()).toEqual([
      expect.stringMatching(/^wiseeff_acceptance_disposable_/u),
      "wiseeff_acceptance_template_foreign",
    ]);
  });

  it("leaves Gate0 lifecycle cleanup with its owner and installs standalone teardown", () => {
    vi.stubEnv("DATABASE_URL", baseDatabaseUrl);
    expect(lifecycle()).toBeTypeOf("function");
    ownedManifest();
    expect(lifecycle()).toBeUndefined();
  });

  it("cleans TEST_DATABASE_URL-only Playwright runs", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("TEST_DATABASE_URL", baseDatabaseUrl);
    await clone();
    const teardown = lifecycle();
    expect(teardown).toBeTypeOf("function");
    await teardown!();
    expect([...state.databases.keys()]).toEqual([expect.stringMatching(/^wiseeff_acceptance_disposable_/u)]);
  });
});
