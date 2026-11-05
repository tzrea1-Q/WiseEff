import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { firstReleaseBundle, compileOrThrow, refreshReleaseSource } from "../catalog-kernel/runtime/catalogChain.fixture";
import type { CatalogReleaseNode } from "../catalog-kernel/compiler/types";
import { createCatalogInstaller } from "../catalog-kernel/install/installer";
import { createCatalogKernel, jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { CatalogSubjectId, DefinitionRevisionId, ParameterDefinitionId } from "../parameter-catalog-contract/index";
import { createRegistrationService } from "../parameter-governance/registration/index";
import { createSourceBackedBindingService } from "../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import type { AuthContext, RoleBinding } from "../auth/types";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerParameterCatalogApi } from "./productionWire";
import { createUsageQueries } from "../parameter-bindings/usage";
import { createUsageProjectionFromQueries } from "./read/ports";
import { bindingCompareListResponseSchema, catalogDefinitionListResponseSchema, catalogDefinitionResponseSchema, catalogProjectConfigurationsResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { parameterListResponseSchema } from "../contracts/dtoSchemas/parameters";
import { createLocalObjectStore } from "../logs/objectStore";

const definitionId = ParameterDefinitionId("pdef_acme_power_iin_max");
const revisionId = DefinitionRevisionId("drev_acme_power_iin_max_1");
const failureReasonSchema = z.object({ error: z.object({ details: z.object({ reason: z.string() }) }) });
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const actors: { id: string; organizationId: string; roles: RoleBinding[]; projects: number; current: number }[] = [
  { id: "only-a", organizationId: "scope-org-a", roles: [{ roleId: "software-user", projectId: "scope-project-a" }], projects: 2, current: 3 },
  { id: "guest-b", organizationId: "scope-org-a", roles: [{ roleId: "guest", projectId: "scope-project-b" }], projects: 2, current: 3 },
  { id: "union", organizationId: "scope-org-a", roles: [{ roleId: "hardware-user", projectId: "scope-project-a" }, { roleId: "software-user", projectId: "scope-project-b" }, { roleId: "guest", projectId: "scope-project-a" }], projects: 2, current: 3 },
  { id: "global-guest", organizationId: "scope-org-a", roles: [{ roleId: "guest", projectId: null }], projects: 2, current: 3 },
  { id: "global-software", organizationId: "scope-org-a", roles: [{ roleId: "software-user", projectId: null }], projects: 2, current: 3 },
  { id: "scoped-admin", organizationId: "scope-org-a", roles: [{ roleId: "admin", projectId: "scope-project-a" }], projects: 2, current: 3 },
  { id: "scoped-platform", organizationId: "scope-org-a", roles: [{ roleId: "platform-admin", projectId: "scope-project-a" }], projects: 2, current: 3 },
  { id: "mixed", organizationId: "scope-org-a", roles: [{ roleId: "guest", projectId: null }, { roleId: "software-user", projectId: "scope-project-a" }], projects: 2, current: 3 },
  { id: "other-org", organizationId: "scope-org-b", roles: [{ roleId: "software-user", projectId: "scope-project-c" }], projects: 1, current: 4 },
  { id: "no-role", organizationId: "scope-org-a", roles: [], projects: 2, current: 3 },
];

describe("R2-SCOPE actual role bindings → root HTTP → PostgreSQL usage", () => {
  let database: ParameterCatalogDatabase;
  let root: RootDatabase;
  let server: Server;
  let storageDirectory: string;
  let baseUrl: string;
  let releaseId: string;
  let measuring = false;
  let businessSql: string[] = [];
  let usageParameters: { definitions: unknown; projects: unknown }[] = [];
  let pauseSummary: { reached: () => void; resume: Promise<void> } | undefined;
  const records: unknown[] = [];
  const actualRoleBindings = new Map<string, unknown>();
  const bindingIds = new Map<string, string>();

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("r2scope");
    storageDirectory = await mkdtemp(path.join(tmpdir(), "parlib-http-"));
    const storage = createLocalObjectStore(storageDirectory);
    root = createPostgresDatabase(database.url);
    const pool = getRootPostgresPool(root);
    if (!pool) throw new Error("real PostgreSQL pool required");
    pool.on("connect", (client) => {
      const query = client.query;
      client.query = function (this: PoolClient, ...args: unknown[]) {
        const input = args[0];
        const sql = typeof input === "string" ? input : input && typeof input === "object" && "text" in input ? String(input.text) : "";
        if (measuring && /parameter_catalog\.(organization_subject_registrations|subject_placements|parameter_review_evidence|parameter_review_items|current_project_parameter_bindings|project_parameter_bindings|project_parameter_values)\b/.test(sql)) {
          businessSql.push(sql);
          if (/from parameter_catalog\.current_project_parameter_bindings binding/.test(sql)) {
            const values = args[1] as unknown;
            usageParameters.push({ definitions: Array.isArray(values) ? values[1] : undefined, projects: Array.isArray(values) ? values[3] : undefined });
          }
        }
        if (pauseSummary && /md5\(coalesce\(string_agg/.test(sql)) {
          const pause = pauseSummary;
          pauseSummary = undefined;
          pause.reached();
          return pause.resume.then(() => Reflect.apply(query, this, args));
        }
        return Reflect.apply(query, this, args);
      } as typeof query;
    });
    const bundle = firstReleaseBundle();
    const release = bundle.releases[0] as Mutable<CatalogReleaseNode>;
    const template = release.documents.find((document) => document.kind === "definition");
    if (!template || template.kind !== "definition") throw new Error("Expected a definition fixture");
    const earlier = structuredClone(template);
    Object.assign(earlier.content, { id: "pdef_scope_earlier", propertyKey: "aaa_scope_unused" });
    Object.assign(earlier.content.revision, { id: "drev_scope_earlier_1", matching: { ...earlier.content.revision.matching, sourceProperty: "aaa_scope_unused" } });
    release.documents.push(earlier);
    refreshReleaseSource(release);
    const compiled = compileOrThrow(bundle);
    const installed = await createCatalogInstaller(pool).installPublishedRelease({ mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.aggregateDigest });
    if (!installed.ok) throw new Error("fixture install failed");
    const pin = { id: compiled.release.id, digest: compiled.release.digest };
    releaseId = pin.id;
    await pool.query("insert into public.organizations(id,name) values ('scope-org-a','Scope A'),('scope-org-b','Scope B')");
    await pool.query("insert into public.projects(id,organization_id,name,code) values ('scope-project-a','scope-org-a','A','A'),('scope-project-b','scope-org-a','B','B'),('scope-project-c','scope-org-b','C','C')");
    for (const actor of actors) {
      await pool.query("insert into public.users(id,organization_id,name,email,title,is_active) values ($1,$2,$1,$3,'Scope fixture',true)", [actor.id, actor.organizationId, `${actor.id}@scope.test`]);
      for (const [index, role] of actor.roles.entries()) {
        await pool.query("insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id) values ($1,$2,$3,$4,$5)", [`scope-role-${actor.id}-${index}`, actor.id, actor.organizationId, role.projectId, role.roleId]);
      }
      actualRoleBindings.set(actor.id, (await pool.query("select role_id, project_id from public.user_role_bindings where user_id=$1 and organization_id=$2 order by role_id,project_id", [actor.id, actor.organizationId])).rows);
    }
    const loaded = await createCatalogKernel(pool).loadCurrentCatalog(pin);
    if (!loaded.ok) throw new Error("fixture snapshot unavailable");
    for (const organizationId of ["scope-org-a", "scope-org-b"]) {
      await pool.query("insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,source_key) values ($1,$2,'driver-registration','Scope driver','compatible:acme,power')", [`attr-${organizationId}`, organizationId]);
      await pool.query("insert into public.driver_registrations(attribution_subject_id,driver_nature,instance_cardinality) values ($1,'physical-device','multiple')", [`attr-${organizationId}`]);
      await pool.query("insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin) values ($1,$2,'Scope driver',$1,1,'business','curated')", [`module-${organizationId}`, organizationId]);
      const registration = await createRegistrationService(pool).execute({ kind: "register", organizationId, subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver", expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: `module-${organizationId}`, method: "explicit", proof: { reason: "scope fixture" }, idempotencyKey: `registration-${organizationId}`, context: { actorKind: "org-admin", principalId: `fixture-${organizationId}` } });
      if (!registration.ok) throw new Error(`fixture registration failed: ${JSON.stringify(registration.error)}`);
      // Independent distribution: A=1 current, B=2 current, other-org C=4 current.
      // Every real binding has two history entries; each project also has a placeholder.
      const projects = organizationId === "scope-org-a" ? [["scope-project-a", 1], ["scope-project-b", 2]] as const : [["scope-project-c", 4]] as const;
      for (const [projectId, currentCount] of projects) {
        for (let index = 0; index <= currentCount; index += 1) {
          if (index === currentCount) continue;
          const binding = await createSourceBackedBindingService(pool, { objectStore: storage, sourceRawValue: "<0x3e9>", initialPayload: { kind: "number", value: 1001 } }).stabilize({ snapshot: loaded.value, organizationId, projectId, logicalNodeId: `${projectId}-node-${index}`, registrationId: registration.value.registrationId, definitionId, effectiveRevisionId: revisionId, expectedEffectiveRevisionId: null });
          if (!binding.ok) throw new Error("fixture binding failed");
          bindingIds.set(projectId, binding.value.binding.id);
        }
      }
    }
    server = createWiseEffServer({ db: root, objectStore: storage, auth: { mode: "production", verifier: { verify: async (authorization): Promise<AuthContext> => {
      const actor = actors.find((candidate) => authorization === `Bearer scope-${candidate.id}`);
      if (!actor) throw new Error("invalid fixture token");
      // Only the identity-provider response is deterministic. Product auth loads
      // actual PostgreSQL roles; forged identity-provider roles cannot grant access.
      return { user: { id: actor.id, organizationId: actor.organizationId, name: actor.id, email: `${actor.id}@scope.test`, emailVerified: true, title: "Admin", isActive: true }, organization: { id: actor.organizationId, name: actor.organizationId }, roles: [{ roleId: "admin", projectId: null }], permissions: ["parameter:view"] };
    } } } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    measuring = false;
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await root?.close();
    await database?.close();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
    const directory = process.env.WISEEFF_CATALOG_SCOPE_EVIDENCE_DIR;
    if (directory) {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "scope-results.json"), JSON.stringify(records, null, 2));
    }
  });

  it.each(actors)("R2-SCOPE-01 $id reads Organization counts in list and detail", async (actor) => {
    const headers = { authorization: `Bearer scope-${actor.id}` };
    businessSql = [];
    usageParameters = [];
    measuring = true;
    const listed = await fetch(`${baseUrl}/api/v2/catalog/definitions?registration=active&limit=25`, { headers });
    const body = catalogDefinitionListResponseSchema.parse(await listed.json());
    measuring = false;
    const item = body.items?.find((entry: { id: string }) => entry.id === definitionId);
    if (!item) throw new Error("Expected the installed definition in the Catalog response");
    records.push({ actor: actor.id, actualDatabaseRoleBindings: actualRoleBindings.get(actor.id), organizationId: actor.organizationId, expected: { projectCount: actor.projects, currentValueCount: actor.current }, actual: item?.usageSummary, status: listed.status, businessQueryCount: businessSql.length, usageParameters });
    expect(listed.status).toBe(200);
    expect(item?.usageSummary).toMatchObject({ policyCount: null, projectCount: actor.projects, currentValueCount: actor.current });
    expect(item?.configurationSummary).toEqual({ configuredProjectCount: actor.projects, configuredInstanceCount: actor.current });
    expect(businessSql).toHaveLength(6);
    expect(usageParameters).toHaveLength(1);
    const detail = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}`, { headers });
    expect(detail.status).toBe(200);
    expect(catalogDefinitionResponseSchema.parse(await detail.json()).item).toEqual(item);
    const named = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}`, { headers: { ...headers, "X-WiseEff-Catalog-Release": releaseId } });
    expect(named.status).toBe(200);
    expect(catalogDefinitionResponseSchema.parse(await named.json()).item.usageSummary).toEqual(item.usageSummary);
    // One installed release: named=current, not historical-release evidence.
    expect(getRootPostgresPool(root)?.waitingCount).toBe(0);
  });

  it("R2-SCOPE-02 request fields cannot widen the authenticated Organization", async () => {
    const response = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}`, { headers: { authorization: "Bearer scope-only-a", "X-Role": "admin", "X-Project-Id": "scope-project-b", "X-Project-Scope": "all", "X-Actor-Kind": "platform-admin" } });
    expect(response.status).toBe(200);
    expect(catalogDefinitionResponseSchema.parse(await response.json()).item.usageSummary).toMatchObject({ policyCount: null, projectCount: 2, currentValueCount: 3 });
    const foreign = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}?organizationId=scope-org-b`, { headers: { authorization: "Bearer scope-only-a" } });
    expect(foreign.status).toBe(403);
  });

  it("R2-SCOPE-03 a roleless Organization reader sees the same configuration usage", async () => {
    const response = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}`, { headers: { authorization: "Bearer scope-no-role" } });
    expect(response.status).toBe(200);
    expect(catalogDefinitionResponseSchema.parse(await response.json()).item.usageSummary).toMatchObject({ policyCount: null, projectCount: 2, currentValueCount: 3 });
  });

  it("R2-SCOPE-04 an explicit empty project selection returns true zero through the real usage port", async () => {
    const pool = getRootPostgresPool(root);
    if (!pool) throw new Error("real PostgreSQL pool required");
    const usage = createUsageProjectionFromQueries(createUsageQueries(pool));
    usageParameters = [];
    measuring = true;
    const summary = await usage.summarize({ organizationId: "scope-org-a", principalId: "only-a", projectScope: { kind: "only", ids: [] }, definitionId });
    measuring = false;
    expect(summary).toMatchObject({ projectCount: 0, currentValueCount: 0 });
    expect(usageParameters).toEqual([{ definitions: [definitionId], projects: [] }]);
    // A deliberately narrower trusted query scope; this is real-PG port evidence,
    // separate from the authenticated root HTTP matrix above.
  });

  it("R2-SCOPE-05 changing a project role does not restrict Organization usage", async () => {
    const pool = getRootPostgresPool(root);
    if (!pool) throw new Error("real PostgreSQL pool required");
    await pool.query("update public.user_role_bindings set project_id='scope-project-b' where id='scope-role-only-a-0'");
    try {
      const response = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}`, { headers: { authorization: "Bearer scope-only-a" } });
      expect(response.status).toBe(200);
      expect(catalogDefinitionResponseSchema.parse(await response.json()).item.usageSummary).toMatchObject({ policyCount: null, projectCount: 2, currentValueCount: 3 });
    } finally {
      await pool.query("update public.user_role_bindings set project_id='scope-project-a' where id='scope-role-only-a-0'");
    }
  });

  it("reads a nonparticipant project but refuses foreign projects and writes", async () => {
    const headers = { authorization: "Bearer scope-only-a", "content-type": "application/json" };
    const local = await fetch(`${baseUrl}/api/v1/parameters?projectId=scope-project-b`, { headers });
    expect(local.status).toBe(200);
    expect(parameterListResponseSchema.parse(await local.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: bindingIds.get("scope-project-b"), projectId: "scope-project-b" })]));
    const foreign = await fetch(`${baseUrl}/api/v1/parameters?projectId=scope-project-c`, { headers });
    expect(foreign.status).toBe(404);
    const foreignBinding = await fetch(`${baseUrl}/api/v1/parameters/${bindingIds.get("scope-project-c")}`, { headers });
    expect(foreignBinding.status).toBe(404);
    for (const path of ["/api/v1/parameter-drafts", "/api/v1/parameter-submission-rounds"]) {
      const body = path.endsWith("drafts")
        ? { projectId: "scope-project-b", parameterId: bindingIds.get("scope-project-b"), targetValue: "9", reason: "scope test" }
        : { projectId: "scope-project-b", items: [{ parameterId: bindingIds.get("scope-project-b"), targetValue: "9", reason: "scope test" }] };
      const denied = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      expect(denied.status).toBe(403);
    }
  });

  it("reads every current instance of a definition across the authorized organization", async () => {
    const response = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations`, {
      headers: { authorization: "Bearer scope-only-a" },
    });
    expect(response.status).toBe(200);
    const body = catalogProjectConfigurationsResponseSchema.parse(await response.json());
    expect(body.summary).toEqual({ configuredProjectCount: 2, configuredInstanceCount: 3 });
    expect(body.totalCount).toBe(3);
    expect(Number.isNaN(Date.parse(body.readAt))).toBe(false);
    expect(body.items).toHaveLength(3);
    expect(body.items.filter((item: { projectId: string }) => item.projectId === "scope-project-b")).toHaveLength(2);
    const instances = body.items.filter((item) => item.kind === "instance");
    expect(instances.every((item) => item.valuePreview === "<1001>")).toBe(true);
    const bindingId = instances[0]!.bindingId;
    const selected = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations?selectedBindingId=${bindingId}&limit=1`, {
      headers: { authorization: "Bearer scope-only-a" },
    });
    const first = catalogProjectConfigurationsResponseSchema.parse(await selected.json());
    expect(first.selected?.rawValue).toBe("<0x3e9>");
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations?cursor=${first.nextCursor}&limit=1`, {
      headers: { authorization: "Bearer scope-only-a" },
    });
    const secondPage = catalogProjectConfigurationsResponseSchema.parse(await second.json());
    expect(secondPage.items[0]).not.toEqual(first.items[0]);
    const third = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations?cursor=${secondPage.nextCursor}&limit=1`, {
      headers: { authorization: "Bearer scope-only-a" },
    });
    const thirdPage = catalogProjectConfigurationsResponseSchema.parse(await third.json());
    expect(thirdPage.continuedProjectId).toBe("scope-project-b");
    const pool = getRootPostgresPool(root)!;
    await pool.query("update public.projects set name='Changed' where id='scope-project-b'");
    try {
      const stale = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations?cursor=${first.nextCursor}`, { headers: { authorization: "Bearer scope-only-a" } });
      expect(stale.status).toBe(400);
      expect(failureReasonSchema.parse(await stale.json()).error.details.reason).toBe("invalid-cursor");
    } finally {
      await pool.query("update public.projects set name='B' where id='scope-project-b'");
    }
    const invalid = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations?cursor=missing`, {
      headers: { authorization: "Bearer scope-only-a" },
    });
    expect(invalid.status).toBe(400);
    const foreign = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations?selectedBindingId=${bindingIds.get("scope-project-c")}`, {
      headers: { authorization: "Bearer scope-only-a" },
    });
    expect(foreign.status).toBe(404);
    const compare = await fetch(`${baseUrl}/api/v2/projects/${body.items[0].projectId}/bindings/${bindingId}/compare`, {
      headers: { authorization: "Bearer scope-only-a" },
    });
    expect(compare.status).toBe(200);
    expect(bindingCompareListResponseSchema.parse(await compare.json()).items.map((item) => item.bindingId).sort())
      .toEqual(instances.slice(1).map((item) => item.bindingId).sort());
  });

  it("filters configurations without confusing unmatched rows with unconfigured projects", async () => {
    const pool = getRootPostgresPool(root)!;
    await pool.query("insert into public.projects(id,organization_id,name,code) values ('scope-empty','scope-org-a','Empty','EMPTY')");
    try {
      const headers = { authorization: "Bearer scope-only-a" };
      const read = async (query: string) => {
        const response = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations?${query}`, { headers });
        expect(response.status).toBe(200);
        return catalogProjectConfigurationsResponseSchema.parse(await response.json());
      };
      const coverage = await read("includeUnconfigured=true");
      expect(coverage.summary).toEqual({ configuredProjectCount: 2, configuredInstanceCount: 3 });
      expect(coverage.totalCount).toBe(4);
      expect(coverage.items).toContainEqual({ kind: "project-status", projectId: "scope-empty", projectName: "Empty", status: "unconfigured" });
      const filtered = await read("includeUnconfigured=true&search=no-such-source");
      expect(filtered.summary.configuredInstanceCount).toBe(3);
      expect(filtered.totalCount).toBe(0);
      const project = await read("projectId=scope-project-b");
      expect(project.totalCount).toBe(2);
      expect(project.items.every((item) => item.projectId === "scope-project-b")).toBe(true);
      const set = project.items.find((item) => item.kind === "instance");
      if (!set || set.kind !== "instance") throw new Error("Expected configured instance");
      expect((await read(`projectId=scope-project-b&configSetId=${set.configSetId}`)).totalCount).toBeGreaterThan(0);
      const wrongOwner = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations?projectId=scope-project-a&configSetId=${set.configSetId}`, { headers });
      expect(wrongOwner.status).toBe(404);
      const first = await read("limit=1");
      const retargeted = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations?limit=1&projectId=scope-project-b&cursor=${first.nextCursor}`, { headers });
      expect(retargeted.status).toBe(400);
    } finally {
      await pool.query("delete from public.projects where id='scope-empty'");
    }
  });

  it("applies configured and project usage before definition pagination", async () => {
    const headers = { authorization: "Bearer scope-only-a" };
    const unfiltered = await fetch(`${baseUrl}/api/v2/catalog/definitions?limit=1`, { headers });
    expect(catalogDefinitionListResponseSchema.parse(await unfiltered.json()).items.map((item) => item.id)).not.toContain(definitionId);
    for (const query of ["configured=true", "usageProjectId=scope-project-b"]) {
      const response = await fetch(`${baseUrl}/api/v2/catalog/definitions?limit=1&${query}`, { headers });
      expect(response.status).toBe(200);
      const body = catalogDefinitionListResponseSchema.parse(await response.json());
      expect(body.items.map((item) => item.id)).toEqual([definitionId]);
      expect(body.totalCount).toBe(1);
    }
    const foreign = await fetch(`${baseUrl}/api/v2/catalog/definitions?usageProjectId=scope-project-c`, { headers });
    expect(foreign.status).toBe(404);
  });

  it("fails explicitly when a current instance loses its owned source pin", async () => {
    const pool = getRootPostgresPool(root)!;
    const bindingId = bindingIds.get("scope-project-b")!;
    await pool.query("alter table parameter_catalog.project_value_source_pins disable trigger all");
    try {
      await pool.query("update parameter_catalog.project_value_source_pins set definition_id='forged-definition' where binding_id=$1", [bindingId]);
      const response = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations`, { headers: { authorization: "Bearer scope-only-a" } });
      expect(response.status).toBe(409);
      expect(failureReasonSchema.parse(await response.json()).error.details.reason).toBe("invalid-source-pin");
      const compare = await fetch(`${baseUrl}/api/v2/projects/scope-project-a/bindings/${bindingIds.get("scope-project-a")}/compare`, { headers: { authorization: "Bearer scope-only-a" } });
      expect(compare.status).toBe(409);
      const detail = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}`, { headers: { authorization: "Bearer scope-only-a" } });
      expect(catalogDefinitionResponseSchema.parse(await detail.json()).item.configurationSummary).toBeNull();
      const filtered = await fetch(`${baseUrl}/api/v2/catalog/definitions?configured=true`, { headers: { authorization: "Bearer scope-only-a" } });
      expect(filtered.status).toBe(409);
    } finally {
      await pool.query("update parameter_catalog.project_value_source_pins set definition_id=$2 where binding_id=$1", [bindingId, definitionId]);
      await pool.query("alter table parameter_catalog.project_value_source_pins enable trigger all");
    }
  });

  it("rejects a current pin with a forged locator digest", async () => {
    const pool = getRootPostgresPool(root)!;
    const bindingId = bindingIds.get("scope-project-b")!;
    const original = (await pool.query<{ locator_digest: string }>("select locator_digest from parameter_catalog.project_value_source_pins where binding_id=$1", [bindingId])).rows[0]!.locator_digest;
    await pool.query("alter table parameter_catalog.project_value_source_pins disable trigger all");
    try {
      await pool.query("update parameter_catalog.project_value_source_pins set locator_digest='sha256:' || repeat('0',64) where binding_id=$1", [bindingId]);
      const response = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations`, { headers: { authorization: "Bearer scope-only-a" } });
      expect(response.status).toBe(409);
      expect(failureReasonSchema.parse(await response.json()).error.details.reason).toBe("invalid-source-pin");
    } finally {
      await pool.query("update parameter_catalog.project_value_source_pins set locator_digest=$2 where binding_id=$1", [bindingId, original]);
      await pool.query("alter table parameter_catalog.project_value_source_pins enable trigger all");
    }
  });

  it("refuses a full source value when the pinned source disagrees with its ProjectValue", async () => {
    const pool = getRootPostgresPool(root)!;
    const bindingId = bindingIds.get("scope-project-b")!;
    await pool.query("alter table parameter_catalog.project_parameter_values disable trigger all");
    try {
      await pool.query(`update parameter_catalog.project_parameter_values set value='1002'::jsonb
        where id=(select current_value_id from parameter_catalog.project_parameter_bindings where id=$1)`, [bindingId]);
      const response = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations?selectedBindingId=${bindingId}`, { headers: { authorization: "Bearer scope-only-a" } });
      expect(response.status).toBe(409);
      expect(failureReasonSchema.parse(await response.json()).error.details.reason).toBe("source-value-disagreement");
    } finally {
      await pool.query(`update parameter_catalog.project_parameter_values set value='1001'::jsonb
        where id=(select current_value_id from parameter_catalog.project_parameter_bindings where id=$1)`, [bindingId]);
      await pool.query("alter table parameter_catalog.project_parameter_values enable trigger all");
    }
  });

  it("does not treat a forged identity marker as a legitimate unset value", async () => {
    const pool = getRootPostgresPool(root)!;
    const bindingId = bindingIds.get("scope-project-b")!;
    const original = (await pool.query<{ source_ref: string }>(`select value.source_ref from parameter_catalog.project_parameter_values value
      join parameter_catalog.project_parameter_bindings binding on binding.current_value_id=value.id where binding.id=$1`, [bindingId])).rows[0]!.source_ref;
    await pool.query("alter table parameter_catalog.project_parameter_values disable trigger all");
    try {
      await pool.query(`update parameter_catalog.project_parameter_values set source_ref='canonical-binding-identity'
        where id=(select current_value_id from parameter_catalog.project_parameter_bindings where id=$1)`, [bindingId]);
      const response = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations`, { headers: { authorization: "Bearer scope-only-a" } });
      expect(response.status).toBe(409);
      expect(failureReasonSchema.parse(await response.json()).error.details.reason).toBe("invalid-source-pin");
    } finally {
      await pool.query(`update parameter_catalog.project_parameter_values set source_ref=$2
        where id=(select current_value_id from parameter_catalog.project_parameter_bindings where id=$1)`, [bindingId, original]);
      await pool.query("alter table parameter_catalog.project_parameter_values enable trigger all");
    }
  });

  it("returns a missing-current-value failure instead of a zero count", async () => {
    const pool = getRootPostgresPool(root)!;
    const bindingId = bindingIds.get("scope-project-b")!;
    const currentValueId = (await pool.query<{ current_value_id: string }>("select current_value_id from parameter_catalog.project_parameter_bindings where id=$1", [bindingId])).rows[0]!.current_value_id;
    await pool.query("alter table parameter_catalog.project_parameter_bindings disable trigger all");
    try {
      await pool.query("update parameter_catalog.project_parameter_bindings set current_value_id='parlib-missing-value' where id=$1", [bindingId]);
      const response = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations`, { headers: { authorization: "Bearer scope-only-a" } });
      expect(response.status).toBe(409);
      expect(failureReasonSchema.parse(await response.json()).error.details.reason).toBe("missing-current-value");
    } finally {
      await pool.query("update parameter_catalog.project_parameter_bindings set current_value_id=$2 where id=$1", [bindingId, currentValueId]);
      await pool.query("alter table parameter_catalog.project_parameter_bindings enable trigger all");
    }
  });


  it("keeps counts and rows in one snapshot during a concurrent project change", async () => {
    let resume!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>((resolve) => { reached = resolve; });
    pauseSummary = { reached, resume: new Promise<void>((resolve) => { resume = resolve; }) };
    const pending = fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}/project-configurations`, { headers: { authorization: "Bearer scope-only-a" } });
    await paused;
    const pool = getRootPostgresPool(root)!;
    try {
      await pool.query("update public.projects set name='Concurrent name' where id='scope-project-b'");
      resume();
      const response = await pending;
      expect(response.status).toBe(200);
      const body = catalogProjectConfigurationsResponseSchema.parse(await response.json());
      expect(body.summary).toEqual({ configuredProjectCount: 2, configuredInstanceCount: 3 });
      expect(body.items.filter((item: { projectId: string }) => item.projectId === "scope-project-b").map((item: { projectName: string }) => item.projectName)).toEqual(["B", "B"]);
    } finally {
      resume(); pauseSummary = undefined;
      await pool.query("update public.projects set name='B' where id='scope-project-b'");
    }
  });

  it("rejects an inactive account despite a previously valid token", async () => {
    const pool = getRootPostgresPool(root)!;
    await pool.query("update public.users set is_active=false where id='only-a'");
    try {
      for (const path of [`/api/v2/catalog/definitions/${definitionId}`, `/api/v2/catalog/definitions/${definitionId}/project-configurations`, "/api/v1/parameters?projectId=scope-project-b"]) {
        const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: "Bearer scope-only-a" } });
        expect([401, 403]).toContain(response.status);
      }
    } finally {
      await pool.query("update public.users set is_active=true where id='only-a'");
    }
  });
});

describe("R2-SCOPE controlled composition rejection, pure boundary evidence", () => {
  it("denies Catalog usage when the trusted resolver withholds parameter:view", async () => {
    const router = createRouter();
    const noView = { user: { id: "no-view", organizationId: "org-a", name: "Reader", title: "Reader", isActive: true }, organization: { id: "org-a", name: "A" }, roles: [], permissions: [] } as AuthContext;
    registerParameterCatalogApi(router, { resolveAuth: () => noView });
    const response = await router.handle({ method: "GET", path: `/api/v2/catalog/definitions/${definitionId}`, params: {}, query: {}, headers: {}, body: undefined, requestId: "no-view" });
    expect(response.status).toBe(403);
    const configurations = await requestJson(createHttpServer(router), `/api/v2/catalog/definitions/${definitionId}/project-configurations`);
    expect(configurations.status).toBe(403);
  });

  it.each([undefined, "", " padded", "bad\u0000id", "bad\u009fid"])("malformed role projectId %j cannot become a global grant", async (projectId) => {
    const router = createRouter();
    // Deliberately malformed resolver input tests fail-closed validation; this
    // controlled unit is not presented as authenticated Agent or PG evidence.
    const malformed = { user: { id: "malformed-user", organizationId: "org-a", name: "Malformed", title: "Admin", isActive: true }, organization: { id: "org-a", name: "A" }, roles: [{ roleId: "admin", projectId }], permissions: ["parameter:view"] } as AuthContext;
    registerParameterCatalogApi(router, { resolveAuth: () => malformed });
    const response = await router.handle({ method: "GET", path: `/api/v2/catalog/definitions/${definitionId}`, params: {}, query: {}, headers: {}, body: undefined, requestId: "controlled-scope" });
    expect(response.status).toBe(403);
  });
});
