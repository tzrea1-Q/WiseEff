import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { firstReleaseBundle, refreshReleaseSource, compileOrThrow } from "../catalog-kernel/runtime/catalogChain.fixture";
import { createCatalogInstaller } from "../catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import type { AuthContext } from "../auth/types";

type Mutable<T> = T extends readonly (infer V)[] ? Mutable<V>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

// Independent fixture inventory: 125 subjects, two definitions per subject.
// Normal catalog rows are produced exclusively by the production installer.
function inventoryBundle() {
  const bundle = structuredClone(firstReleaseBundle()) as Mutable<ReturnType<typeof firstReleaseBundle>>;
  const release = bundle.releases[0]!;
  const subject = release.documents.find((document) => document.kind === "subject");
  const definition = release.documents.find((document) => document.kind === "definition");
  if (!subject || subject.kind !== "subject" || !definition || definition.kind !== "definition") throw new Error("missing fixture templates");
  release.documents = [];
  for (let index = 0; index < 125; index += 1) {
    const id = `csub_batch_${String(index).padStart(3, "0")}`;
    const next = structuredClone(subject);
    next.content.id = id;
    next.content.canonicalKey = `driver:batch,device-${index}`;
    next.content.selector.value = `batch,device-${index}`;
    release.documents.push(next);
    for (let property = 0; property < 2; property += 1) {
      const item = structuredClone(definition);
      item.content.id = `pdef_batch_${index}_${property}`;
      item.content.subjectId = id;
      item.content.propertyKey = `batch_value_${property}`;
      item.content.revision.id = `drev_batch_${index}_${property}_1`;
      item.content.revision.matching.sourceProperty = `batch_value_${property}`;
      release.documents.push(item);
    }
  }
  refreshReleaseSource(release);
  return bundle;
}

type SqlClass = "auth" | "kernel" | "business" | "transaction" | "other";
function classify(sql: string): SqlClass {
  if (/^\s*(begin|commit|rollback|set\s|reset\s)/i.test(sql)) return "transaction";
  if (/parameter_catalog\.(organization_subject_registrations|subject_placements|parameter_review_evidence|parameter_review_items|project_parameter_bindings|project_parameter_values)\b/i.test(sql)) return "business";
  if (/parameter_catalog\.(catalog_state|catalog_releases|catalog_materializations|catalog_release_subjects|catalog_subjects|catalog_release_subject_aliases|catalog_subject_aliases|catalog_release_definition_heads|parameter_definitions|definition_revisions)\b/i.test(sql)) return "kernel";
  if (/\b(users|user_role_bindings|role_permissions|roles|organizations|local_auth_sessions)\b/i.test(sql)) return "auth";
  return "other";
}

describe("R2-BATCH root HTTP SQL budget", () => {
  let database: ParameterCatalogDatabase;
  let root: RootDatabase;
  let server: Server;
  let baseUrl: string;
  let measuring = false;
  let statements: { category: SqlClass; sql: string }[] = [];
  const principal: AuthContext = {
    user: { id: "batch-admin", organizationId: "batch-org", name: "Batch admin", email: "batch@example.test", emailVerified: true, title: "Admin", isActive: true },
    organization: { id: "batch-org", name: "Batch" }, roles: [], permissions: [],
  };

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("r2batch");
    root = createPostgresDatabase(database.url);
    const pool = getRootPostgresPool(root);
    if (!pool) throw new Error("real root PostgreSQL pool required");
    pool.on("connect", (client) => {
      const query = client.query;
      client.query = function (...args: Parameters<typeof query>) {
        const input = args[0];
        const sql = typeof input === "string" ? input : input && "text" in input ? String(input.text) : "<non-text query>";
        if (measuring) statements.push({ category: classify(sql), sql: sql.replace(/\s+/g, " ").trim() });
        return Reflect.apply(query, this, args);
      } as typeof query;
    });
    const bundle = inventoryBundle();
    const compiled = compileOrThrow(bundle);
    const installed = await createCatalogInstaller(pool).installPublishedRelease({ mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.aggregateDigest });
    expect(installed.ok, JSON.stringify(installed)).toBe(true);
    await pool.query("insert into public.organizations(id,name) values ('batch-org','Batch')");
    await pool.query("insert into public.users(id,organization_id,name,email,title,is_active) values ('batch-admin','batch-org','Batch admin','batch@example.test','Admin',true)");
    await pool.query("insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('batch-role','batch-admin','batch-org',null,'admin')");
    server = createWiseEffServer({ db: root, auth: { mode: "production", verifier: { verify: async (authorization) => {
      if (authorization !== "Bearer batch-fixture-token") throw new Error("invalid fixture credential");
      return principal;
    } } } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    measuring = false;
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await root?.close();
    await database?.close();
  });

  // Frozen before execution: 3 registration/review SELECTs plus 1 prefilter;
  // definitions add one usage aggregate. Policy remains a separately blocked contract.
  it.each([1, 25, 100])("R2-BATCH-01/02 projects subjects with a fixed budget at limit %i", async (limit) => {
    statements = [];
    measuring = true;
    const started = performance.now();
    const response = await fetch(`${baseUrl}/api/v2/catalog/subjects?limit=${limit}`, { headers: { authorization: "Bearer batch-fixture-token" } });
    const body = await response.json();
    measuring = false;
    const counts = Object.fromEntries(["auth", "kernel", "business", "transaction", "other"].map((category) => [category, statements.filter((entry) => entry.category === category).length]));
    const evidence = { evidence: "R2-BATCH", route: "subjects", limit, status: response.status, counts, elapsedMs: performance.now() - started, waiting: getRootPostgresPool(root)?.waitingCount, statements };
    console.info(JSON.stringify(evidence));
    const evidenceDirectory = process.env.WISEEFF_CATALOG_SQL_EVIDENCE_DIR;
    if (evidenceDirectory) {
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(path.join(evidenceDirectory, `subjects-${limit}.json`), JSON.stringify(evidence, null, 2));
    }
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.items).toHaveLength(limit);
    expect(counts.other, "all actual SQL must be classified").toBe(0);
    expect(counts.auth).toBeGreaterThan(0);
    expect(counts.kernel).toBeGreaterThan(0);
    expect(counts.business, "fixed page projection + prefilter budget").toBe(4);
    expect(getRootPostgresPool(root)?.waitingCount).toBe(0);
  });
  it("R2-BATCH-03 empty Subject page performs only prefilter SQL", async () => {
    statements = [];
    measuring = true;
    const response = await fetch(`${baseUrl}/api/v2/catalog/subjects?search=no-such-subject`, { headers: { authorization: "Bearer batch-fixture-token" } });
    const body = await response.json();
    measuring = false;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.items).toEqual([]);
    expect(statements.filter((entry) => entry.category === "business")).toHaveLength(1);
    expect(statements.some((entry) => /parameter_review_(evidence|items)/.test(entry.sql))).toBe(false);
  });
});
