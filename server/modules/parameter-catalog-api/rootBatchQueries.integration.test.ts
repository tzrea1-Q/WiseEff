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
import { createCatalogKernel, jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { CatalogSubjectId, DefinitionRevisionId, ParameterDefinitionId } from "../parameter-catalog-contract/index";
import { createRegistrationService } from "../parameter-governance/registration/index";
import { createEvidenceIngest } from "../parameter-governance/evidence/index";
import { stabilizeCanonicalBinding } from "../parameter-bindings/binding/index";
import { appendProjectValue } from "../parameter-bindings/values/index";
import type { AuthContext } from "../auth/types";

type Mutable<T> = T extends readonly (infer V)[] ? Mutable<V>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

const subjectCount = Number(process.env.WISEEFF_CATALOG_BATCH_SUBJECTS ?? 125);
const capacityProfile = process.env.WISEEFF_CATALOG_CAPACITY_PROFILE === "1";
if (!Number.isSafeInteger(subjectCount) || subjectCount < 1 || subjectCount > 1000) {
  throw new Error("WISEEFF_CATALOG_BATCH_SUBJECTS must be an integer in 1..1000");
}
// Independently declared inventory: two definitions per subject.
// Normal catalog rows are produced exclusively by the production installer.
function inventoryBundle() {
  const bundle = structuredClone(firstReleaseBundle()) as Mutable<ReturnType<typeof firstReleaseBundle>>;
  const release = bundle.releases[0]!;
  const subject = release.documents.find((document) => document.kind === "subject");
  const definition = release.documents.find((document) => document.kind === "definition");
  if (!subject || subject.kind !== "subject" || !definition || definition.kind !== "definition") throw new Error("missing fixture templates");
  release.documents = [];
  for (let index = 0; index < subjectCount; index += 1) {
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
  let releaseId: string;
  let pinnedReleaseId: string;
  let measuring = false;
  let projectionFailure: "usage" | "registration" | undefined;
  let injectedFailures = 0;
  let statements: { category: SqlClass; sql: string; batchIds?: readonly string[] }[] = [];
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
        const rejectProjection = projectionFailure === "usage"
          ? /from parameter_catalog\.project_parameter_bindings binding/.test(sql)
          : projectionFailure === "registration" && /from parameter_catalog\.organization_subject_registrations registration/.test(sql);
        if (rejectProjection) {
          injectedFailures += 1;
          // Controlled read-only PostgreSQL failure on this disposable harness's client.
          // Domain queries and the actual production projection adapters still execute.
          return Reflect.apply(query, this, ["select 1 / 0"]);
        }
        if (measuring) {
          const values = args[1] as unknown;
          const batchIds = classify(sql) === "business" && Array.isArray(values) && Array.isArray(values[1])
            ? values[1].filter((value): value is string => typeof value === "string") : undefined;
          statements.push({ category: classify(sql), sql: sql.replace(/\s+/g, " ").trim(), batchIds });
        }
        return Reflect.apply(query, this, args);
      } as typeof query;
    });
    const bundle = inventoryBundle();
    const compiled = compileOrThrow(bundle);
    const installed = await createCatalogInstaller(pool).installPublishedRelease({ mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.aggregateDigest });
    expect(installed.ok, JSON.stringify(installed)).toBe(true);
    releaseId = compiled.release.id;
    pinnedReleaseId = releaseId;
    await pool.query("insert into public.organizations(id,name) values ('batch-org','Batch')");
    await pool.query("insert into public.users(id,organization_id,name,email,title,is_active) values ('batch-admin','batch-org','Batch admin','batch@example.test','Admin',true)");
    await pool.query("insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('batch-role','batch-admin','batch-org',null,'admin')");
    await pool.query("insert into public.organizations(id,name) values ('batch-other','Other')");
    await pool.query("insert into public.users(id,organization_id,name,email,title,is_active) values ('batch-other-admin','batch-other','Other admin','other@example.test','Admin',true)");
    await pool.query("insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('batch-other-role','batch-other-admin','batch-other',null,'admin')");
    await pool.query("insert into public.projects(id,organization_id,name,code) values ('batch-project-a','batch-org','A','A'),('batch-project-b','batch-org','B','B')");
    await pool.query("insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,source_key) values ('batch-attr','batch-org','driver-registration','Batch driver','compatible:batch,device-0')");
    await pool.query("insert into public.driver_registrations(attribution_subject_id,driver_nature,instance_cardinality) values ('batch-attr','physical-device','multiple')");
    await pool.query("insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id) values ('batch-module','batch-org','Batch driver','batch-module',1,'driver-group','curated','batch-attr')");
    const pin = { id: compiled.release.id, digest: compiled.release.digest };
    const registered = await createRegistrationService(pool).execute({ kind: "register", organizationId: "batch-org", subjectId: CatalogSubjectId("csub_batch_000"), subjectKind: "driver", expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: "batch-module", method: "explicit", proof: { reason: "batch fixture" }, idempotencyKey: "batch-register", context: { actorKind: "org-admin", principalId: "batch-admin" } });
    if (!registered.ok) throw new Error(`registration fixture failed: ${JSON.stringify(registered.error)}`);
    const loaded = await createCatalogKernel(pool).loadCurrentCatalog(pin);
    if (!loaded.ok) throw new Error("fixture snapshot unavailable");
    for (const [logicalNodeId, projectId, writes] of [["batch-node-a", "batch-project-a", 2], ["batch-node-b", "batch-project-b", 2], ["batch-placeholder", "batch-project-a", 0]] as const) {
      const bound = await stabilizeCanonicalBinding(pool, { snapshot: loaded.value, organizationId: "batch-org", projectId, logicalNodeId, registrationId: registered.value.registrationId, definitionId: ParameterDefinitionId("pdef_batch_0_0"), effectiveRevisionId: DefinitionRevisionId("drev_batch_0_0_1"), expectedEffectiveRevisionId: null });
      if (!bound.ok) throw new Error(`binding fixture failed: ${JSON.stringify(bound.error)}`);
      let expectedTip = bound.value.binding.currentValueId;
      for (let revision = 1; revision <= writes; revision += 1) {
        const appended = await appendProjectValue(pool, { snapshot: loaded.value, binding: bound.value.binding, definitionRevisionId: DefinitionRevisionId("drev_batch_0_0_1"), source: { sourceRef: `config-set:${logicalNodeId}`, configRevisionId: `batch-revision-${revision}` }, payload: { kind: "number", value: 1000 + revision }, expectedTip });
        if (!appended.ok) throw new Error(`value fixture failed: ${JSON.stringify(appended.error)}`);
        expectedTip = appended.value.currentTip;
      }
    }
    const reviewInput = { organizationId: "batch-org", sourceIdentity: "batch-review-source", catalogReleaseId: pin.id,
      matcherRevision: "batch-matcher", matcherOutput: { status: "unknown" as const },
      evidence: { propertyKey: "batch_value_0", subjectId: "csub_batch_000" } };
    const ingest = createEvidenceIngest(pool);
    expect((await ingest.ingest(reviewInput)).ok).toBe(true);
    expect((await ingest.ingest(reviewInput)).ok).toBe(true);
    const reviewFixture = await pool.query<{ evidence_rows: number; persisted_items: number }>(
      `select (select count(*)::int from parameter_catalog.parameter_review_evidence where organization_id = $1) as evidence_rows,
              (select count(*)::int from parameter_catalog.parameter_review_items where organization_id = $1) as persisted_items`,
      ["batch-org"],
    );
    expect(reviewFixture.rows).toEqual([{ evidence_rows: 1, persisted_items: 0 }]);
    if (capacityProfile) {
      const predecessor = bundle.releases[0]!;
      const next = structuredClone(predecessor);
      next.manifest.release = { ...next.manifest.release, id: "crel_batch_capacity_2", version: "1.1.0", sequence: 2,
        publishedAt: "2026-09-02T00:00:00Z", predecessor: { id: compiled.release.id, digest: compiled.release.digest } };
      const changed = next.documents.find((document) => document.kind === "definition" && document.content.id === "pdef_batch_0_0");
      if (!changed || changed.kind !== "definition") throw new Error("capacity successor Definition missing");
      changed.content.revision = { ...changed.content.revision, id: "drev_batch_0_0_2", number: 2, documentation: "Capacity successor revision; pinned bindings retain revision one." };
      refreshReleaseSource(next);
      const successor = { ...bundle, targetReleaseId: next.manifest.release.id, releases: [...bundle.releases, next] };
      const nextCompiled = compileOrThrow(successor);
      const advanced = await createCatalogInstaller(pool).installPublishedRelease({ mode: "advance", source: jsonCatalogReleaseSource(successor), expectedCurrent: pin, expectedTargetDigest: nextCompiled.aggregateDigest });
      expect(advanced.ok, JSON.stringify(advanced)).toBe(true);
      releaseId = nextCompiled.release.id;
    }
    server = createWiseEffServer({ db: root, auth: { mode: "production", verifier: { verify: async (authorization) => {
      if (authorization === "Bearer batch-other-token") return { ...principal, user: { ...principal.user, id: "batch-other-admin", organizationId: "batch-other" }, organization: { id: "batch-other", name: "Other" } };
      if (authorization !== "Bearer batch-fixture-token") throw new Error("invalid fixture credential");
      return principal;
    } } } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  function resources() {
    const pool = getRootPostgresPool(root);
    return { inventory: { subjects: subjectCount, definitions: subjectCount * 2 }, pool: { max: pool?.options.max, total: pool?.totalCount, idle: pool?.idleCount, waiting: pool?.waitingCount, used: pool ? pool.totalCount - pool.idleCount : undefined }, memoryBytes: process.memoryUsage() };
  }

  afterAll(async () => {
    measuring = false;
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await root?.close();
    await database?.close();
  });

  // Frozen before execution: 3 registration/review SELECTs plus 1 prefilter;
  // definitions add one usage aggregate. Policy remains a separately blocked contract.
  it.each([
    ["usage", "/definitions"],
    ["usage", "/subjects/csub_batch_000/definitions"],
    ["usage", "/definitions/pdef_batch_0_0"],
    ["registration", "/definitions"],
    ["registration", "/subjects/csub_batch_000/definitions"],
    ["registration", "/definitions/pdef_batch_0_0"],
    ["registration", "/subjects"],
    ["registration", "/subjects/csub_batch_000"],
  ] as const)("R2-ASYNC root %s adapter rejection retains the complete contract for %s", async (projection, route) => {
    projectionFailure = projection;
    injectedFailures = 0;
    try {
      const response = await fetch(`${baseUrl}/api/v2/catalog${route}`, { headers: { authorization: "Bearer batch-fixture-token", "x-request-id": "r2-async-rejection" } });
      const body = await response.json();
      expect(injectedFailures).toBe(1);
      expect(response.status, JSON.stringify(body)).toBe(503);
      expect(response.headers.get("retry-after")).toBe("5");
      const requestId = response.headers.get("x-request-id");
      expect(requestId).toBe("r2-async-rejection");
      expect(body).toEqual({ error: { code: "SERVICE_UNAVAILABLE", message: "Catalog is not ready.", details: { reason: "catalog-not-ready", retryable: true }, requestId } });
    } finally {
      projectionFailure = undefined;
    }
    const recovered = await fetch(`${baseUrl}/api/v2/catalog${route}`, { headers: { authorization: "Bearer batch-fixture-token" } });
    expect(recovered.status).toBe(200);
    await recovered.json();
    expect(injectedFailures).toBe(1);
    expect(getRootPostgresPool(root)?.waitingCount).toBe(0);
    expect(resources().pool.used).toBe(0);
  });
  it.each([1, 25, 100])("R2-BATCH-01/02 projects subjects with a fixed budget at limit %i", async (limit) => {
    statements = [];
    measuring = true;
    const started = performance.now();
    const response = await fetch(`${baseUrl}/api/v2/catalog/subjects?limit=${limit}`, { headers: { authorization: "Bearer batch-fixture-token" } });
    const body = await response.json();
    measuring = false;
    const counts = Object.fromEntries(["auth", "kernel", "business", "transaction", "other"].map((category) => [category, statements.filter((entry) => entry.category === category).length]));
    const evidence = { evidence: "R2-BATCH", route: "subjects", limit, status: response.status, counts, elapsedMs: performance.now() - started, ...resources(), statements };
    console.info(JSON.stringify(evidence));
    const evidenceDirectory = process.env.WISEEFF_CATALOG_SQL_EVIDENCE_DIR;
    if (evidenceDirectory) {
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(path.join(evidenceDirectory, `subjects-${limit}.json`), JSON.stringify(evidence, null, 2));
    }
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.items).toHaveLength(Math.min(limit, subjectCount));
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

  it.each([1, 25, 100])("R2-BATCH-01/02 projects Definitions with the frozen five-query budget at limit %i", async (limit) => {
    statements = [];
    measuring = true;
    const started = performance.now();
    const response = await fetch(`${baseUrl}/api/v2/catalog/definitions?limit=${limit}`, { headers: { authorization: "Bearer batch-fixture-token" } });
    const body = await response.json();
    measuring = false;
    const counts = Object.fromEntries(["auth", "kernel", "business", "transaction", "other"].map((category) => [category, statements.filter((entry) => entry.category === category).length]));
    const evidence = { evidence: "R2-BATCH", route: "definitions", limit, status: response.status, counts, elapsedMs: performance.now() - started, ...resources(), statements };
    console.info(JSON.stringify(evidence));
    const evidenceDirectory = process.env.WISEEFF_CATALOG_SQL_EVIDENCE_DIR;
    if (evidenceDirectory) {
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(path.join(evidenceDirectory, `definitions-${limit}.json`), JSON.stringify(evidence, null, 2));
    }
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.items).toHaveLength(Math.min(limit, subjectCount * 2));
    expect(counts.other, "all actual SQL must be classified").toBe(0);
    expect(counts.auth).toBeGreaterThan(0);
    expect(counts.kernel).toBeGreaterThan(0);
    expect(counts.business, "prefilter + three registration/review + one usage query, irrespective of rows").toBe(5);
    const projectedSubjects = statements.find((entry) => entry.batchIds && /organization_subject_registrations/.test(entry.sql));
    const projectedDefinitions = statements.find((entry) => entry.batchIds && /project_parameter_bindings/.test(entry.sql));
    expect(projectedSubjects?.batchIds?.slice().sort()).toEqual([...new Set<string>(body.items.map((item: { subject: { id: string } }) => item.subject.id))].sort());
    expect(projectedDefinitions?.batchIds?.slice().sort()).toEqual(body.items.map((item: { id: string }) => item.id).sort());
    for (const statement of statements.filter((entry) => entry.batchIds)) {
      expect(statement.batchIds).toHaveLength(new Set(statement.batchIds).size);
    }
    expect(getRootPostgresPool(root)?.waitingCount).toBe(0);
  });
  it("R2-BATCH-04 empty Definition page performs only prefilter SQL and rejects an invalid limit", async () => {
    statements = [];
    measuring = true;
    const response = await fetch(`${baseUrl}/api/v2/catalog/definitions?search=no-such-definition`, { headers: { authorization: "Bearer batch-fixture-token" } });
    const body = await response.json();
    measuring = false;
    expect(response.status).toBe(200);
    expect(body.items).toEqual([]);
    expect(statements.filter((entry) => entry.category === "business")).toHaveLength(1);
    const invalid = await fetch(`${baseUrl}/api/v2/catalog/definitions?limit=101`, { headers: { authorization: "Bearer batch-fixture-token" } });
    expect(invalid.status).toBe(400);
  });

  it("R2-BATCH-05 registration filtering precedes cursor pagination and retains nonzero/current-pointer usage", async () => {
    const headers = { authorization: "Bearer batch-fixture-token" };
    const first = await fetch(`${baseUrl}/api/v2/catalog/definitions?registration=active&limit=1`, { headers });
    const firstPage = await first.json();
    expect(first.status).toBe(200);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const second = await fetch(`${baseUrl}/api/v2/catalog/definitions?registration=active&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`, { headers });
    const secondPage = await second.json();
    expect(second.status).toBe(200);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    const items = [...firstPage.items, ...secondPage.items];
    expect(items.map((item) => item.id).sort()).toEqual(["pdef_batch_0_0", "pdef_batch_0_1"]);
    // Three bindings in two projects, two current non-placeholder pointers and
    // four historical writes. Policy remains outside this acceptance claim.
    expect(items.find((item) => item.id === "pdef_batch_0_0").usageSummary).toMatchObject({ projectCount: 2, currentValueCount: 2 });
    expect(items.find((item) => item.id === "pdef_batch_0_1").usageSummary).toMatchObject({ projectCount: 0, currentValueCount: 0 });
    for (const item of items) {
      const detail = await fetch(`${baseUrl}/api/v2/catalog/definitions/${item.id}`, { headers });
      expect(detail.status).toBe(200);
      expect((await detail.json()).item).toEqual(item);
    }
    const named = await fetch(`${baseUrl}/api/v2/catalog/definitions?registration=active&limit=2`, { headers: { ...headers, "X-WiseEff-Catalog-Release": releaseId } });
    expect(named.status).toBe(200);
    expect((await named.json()).items).toEqual(items);
    // The named pin equals current here; this does not prove release drift.
  });

  it("R2-BATCH-06 another authenticated organization cannot inherit registration or usage", async () => {
    const headers = { authorization: "Bearer batch-other-token" };
    const filtered = await fetch(`${baseUrl}/api/v2/catalog/definitions?registration=active&limit=25`, { headers });
    expect(filtered.status).toBe(200);
    expect((await filtered.json()).items).toEqual([]);
    const detail = await fetch(`${baseUrl}/api/v2/catalog/definitions/pdef_batch_0_0`, { headers });
    expect(detail.status).toBe(200);
    const item = (await detail.json()).item;
    expect(item.registration.status).toBe("unregistered");
    expect(item.usageSummary).toMatchObject({ projectCount: 0, currentValueCount: 0 });
  });

  it("R2-BATCH-07 duplicated review ingestion yields one review in list/detail and none across organizations", async () => {
    // Evidence belongs to release one; the capacity-only advance selects a
    // different current release without migrating that evidence.
    for (const [authorization, expectedCount] of [["Bearer batch-fixture-token", capacityProfile ? 0 : 1], ["Bearer batch-other-token", 0]] as const) {
      const headers = { authorization };
      const list = await fetch(`${baseUrl}/api/v2/catalog/subjects?limit=1`, { headers });
      expect(list.status).toBe(200);
      expect((await list.json()).items[0]).toMatchObject({ id: "csub_batch_000", reviewCount: expectedCount });
      const detail = await fetch(`${baseUrl}/api/v2/catalog/subjects/csub_batch_000`, { headers });
      expect(detail.status).toBe(200);
      expect((await detail.json()).item).toMatchObject({ id: "csub_batch_000", reviewCount: expectedCount });
    }
  });

  // Explicit opt-in measurement profile, executed separately from the default
  // regression suite. It retains the normal 30s per-case budget and pool size.
  if (capacityProfile) {
    for (const snapshot of ["current", "pinned"] as const) {
      for (const route of ["subjects", "definitions"] as const) {
        const scenarios = [
          ...[1, 25, 100].map((limit) => ({ name: `first-${limit}`, limit, detail: false, after: false, registered: false })),
          { name: "next-1", limit: 1, detail: false, after: true, registered: false },
          { name: "registered-25", limit: 25, detail: false, after: false, registered: true },
          { name: "detail", limit: 1, detail: true, after: false, registered: false },
        ];
        for (const scenario of scenarios) {
          it.each([1, 4])(`R2-CAP ${snapshot}/${route}/${scenario.name} concurrency %i`, async (concurrency) => {
            const evidenceDirectory = process.env.WISEEFF_CATALOG_SQL_EVIDENCE_DIR;
            if (!evidenceDirectory) throw new Error("capacity profile requires an evidence directory");
            await mkdir(evidenceDirectory, { recursive: true });
            const filename = `capacity-${subjectCount}-${snapshot}-${route}-${scenario.name}-c${concurrency}.json`;
            const headers: Record<string, string> = { authorization: "Bearer batch-fixture-token" };
            if (snapshot === "pinned") headers["X-WiseEff-Catalog-Release"] = pinnedReleaseId;
            const expectedRelease = snapshot === "pinned" ? pinnedReleaseId : releaseId;
            const definition = route === "definitions";
            const detailId = definition ? "pdef_batch_0_0" : "csub_batch_000";
            const query = new URLSearchParams({ limit: String(scenario.limit) });
            if (snapshot === "pinned") query.set("catalogReleaseId", pinnedReleaseId);
            if (scenario.registered) query.set("registration", "active");
            if (scenario.after) {
              const firstQuery = new URLSearchParams(query);
              firstQuery.set("limit", "1");
              const first = await fetch(`${baseUrl}/api/v2/catalog/${route}?${firstQuery}`, { headers });
              const firstPage = await first.json();
              expect(first.status).toBe(200);
              expect(firstPage.nextCursor).toEqual(expect.any(String));
              query.set("cursor", firstPage.nextCursor);
            }
            const endpoint = `/api/v2/catalog/${route}${scenario.detail ? `/${detailId}` : ""}?${query}`;
            const expectedRows = scenario.detail ? 1 : scenario.registered ? definition ? 2 : 1
              : Math.min(scenario.limit, subjectCount * (definition ? 2 : 1) - (scenario.after ? 1 : 0));
            const businessBudget = (definition ? 5 : 4) - (scenario.detail ? 1 : 0);
            const rounds: { phase: string; elapsedMs: number[]; counts: Record<string, number>; resources: ReturnType<typeof resources>; statements: typeof statements }[] = [];
            async function batch(phase: string) {
              statements = [];
              measuring = true;
              // Concurrent HTTP load is measured here; the production batch
              // projection still issues the same fixed number of SQL queries.
              const attempts = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
                const start = performance.now();
                const response = await fetch(`${baseUrl}${endpoint}`, { headers, signal: AbortSignal.timeout(10_000) });
                const body = await response.json();
                expect(response.status, JSON.stringify(body)).toBe(200);
                expect(response.headers.get("X-WiseEff-Catalog-Release")).toBe(expectedRelease);
                if (!scenario.detail) expect(body.catalogReleaseId).toBe(expectedRelease);
                const items = scenario.detail ? [body.item] : body.items;
                expect(items).toHaveLength(expectedRows);
                if (definition) {
                  for (const item of items) {
                    const populated = item.id === "pdef_batch_0_0";
                    expect(item.usageSummary).toMatchObject({ projectCount: populated ? 2 : 0, currentValueCount: populated ? 2 : 0 });
                    expect(item.currentRevision.id).toBe(populated && snapshot === "current" ? "drev_batch_0_0_2" : `drev_${item.id.slice("pdef_".length)}_1`);
                  }
                } else {
                  expect(items.every((item: { membership: { catalogReleaseId: string } }) => item.membership.catalogReleaseId === expectedRelease)).toBe(true);
                  for (const item of items) expect(item.reviewCount).toBe(item.id === "csub_batch_000" && snapshot === "pinned" ? 1 : 0);
                }
                return performance.now() - start;
              }));
              measuring = false;
              const counts = Object.fromEntries(["auth", "kernel", "business", "transaction", "other"].map((category) => [category, statements.filter((entry) => entry.category === category).length]));
              const failed = attempts.filter((attempt) => attempt.status === "rejected");
              const elapsedMs = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
              const state = resources();
              rounds.push({ phase, elapsedMs, counts, resources: state, statements });
              // Persist before assertions so HTTP, SQL-budget and pool failures
              // all retain the observed batch and every earlier measurement.
              const partial = { requirement: "R2-CAP", snapshot, route, scenario: scenario.name, endpoint, expectedRelease,
                concurrency, businessQueriesPerRequest: businessBudget, rounds };
              await writeFile(path.join(evidenceDirectory!, filename), JSON.stringify({ ...partial, status: "running" }, null, 2));
              try {
                if (failed.length > 0) throw new AggregateError(failed.map((attempt) => attempt.reason), "Capacity requests failed");
                expect(counts.business).toBe(businessBudget * concurrency);
                expect(counts.other).toBe(0);
                expect(state.pool.waiting).toBe(0);
                expect(state.pool.used).toBe(0);
              } catch (error) {
                const failure = { ...partial, status: "failed", error: error instanceof Error ? error.message : String(error),
                  requestErrors: failed.map((attempt) => attempt.reason instanceof Error ? attempt.reason.message : String(attempt.reason)) };
                await writeFile(path.join(evidenceDirectory!, filename), JSON.stringify(failure, null, 2));
                console.info(JSON.stringify({ evidence: "R2-CAP-failure", ...failure }));
                throw error;
              }
            }
            await batch("first-observed");
            await batch("warmup");
            for (let sample = 0; sample < 5; sample += 1) await batch("measured-warm");
            const samples = rounds.filter((round) => round.phase === "measured-warm").flatMap((round) => round.elapsedMs).sort((a, b) => a - b);
            const percentile = (fraction: number) => samples[Math.ceil(samples.length * fraction) - 1];
            const report = { status: "passed", requirement: "R2-CAP", snapshot, route, scenario: scenario.name, endpoint, expectedRelease,
              fixture: { subjects: subjectCount, definitions: subjectCount * 2, organizations: 2, projectsWithBindings: 2, registrations: 1, bindings: 3, nonPlaceholderHistory: 4, currentNonPlaceholder: 2, placeholderBindings: 1, duplicateReviewIngestions: 2,
                reviewEvidenceRows: 1, persistedReviewItems: 0, reviewEvidenceReleaseId: pinnedReleaseId, projectedReviewCountCurrent: 0, projectedReviewCountPinned: 1 },
              concurrency, sampleCount: samples.length, warmupRequests: concurrency, businessQueriesPerRequest: businessBudget,
              p50Ms: percentile(0.5), p95Ms: percentile(0.95), latencySlo: "unavailable; observational baseline only",
              coldCache: "unavailable; no OS/PostgreSQL cache reset; first-observed is not a cold-cache claim",
              connectionWaitMs: "unavailable; pool waiting/used snapshots are recorded after every settled batch", rounds };
            await writeFile(path.join(evidenceDirectory, filename), JSON.stringify(report, null, 2));
            console.info(JSON.stringify({ ...report, rounds: undefined, artifact: filename }));
          });
        }
      }
    }
  }
});
