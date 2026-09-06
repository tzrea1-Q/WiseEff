import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { firstReleaseBundle, compileOrThrow } from "../catalog-kernel/runtime/catalogChain.fixture";
import { createCatalogInstaller } from "../catalog-kernel/install/installer";
import { createCatalogKernel, jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { CatalogSubjectId, DefinitionRevisionId, ParameterDefinitionId } from "../parameter-catalog-contract/index";
import { createRegistrationService } from "../parameter-governance/registration/index";
import { stabilizeCanonicalBinding } from "../parameter-bindings/binding/index";
import { appendProjectValue } from "../parameter-bindings/values/index";
import type { AuthContext, RoleBinding } from "../auth/types";
import { createRouter } from "../../shared/http/router";
import { registerParameterCatalogApi } from "./productionWire";
import { createUsageQueries } from "../parameter-bindings/usage";
import { createUsageProjectionFromQueries } from "./read/ports";

const definitionId = ParameterDefinitionId("pdef_acme_power_iin_max");
const revisionId = DefinitionRevisionId("drev_acme_power_iin_max_1");
const actors: { id: string; organizationId: string; roles: RoleBinding[]; projects: number; current: number }[] = [
  { id: "only-a", organizationId: "scope-org-a", roles: [{ roleId: "software-user", projectId: "scope-project-a" }], projects: 1, current: 1 },
  { id: "guest-b", organizationId: "scope-org-a", roles: [{ roleId: "guest", projectId: "scope-project-b" }], projects: 1, current: 2 },
  { id: "union", organizationId: "scope-org-a", roles: [{ roleId: "hardware-user", projectId: "scope-project-a" }, { roleId: "software-user", projectId: "scope-project-b" }, { roleId: "guest", projectId: "scope-project-a" }], projects: 2, current: 3 },
  { id: "global-guest", organizationId: "scope-org-a", roles: [{ roleId: "guest", projectId: null }], projects: 2, current: 3 },
  { id: "global-software", organizationId: "scope-org-a", roles: [{ roleId: "software-user", projectId: null }], projects: 2, current: 3 },
  { id: "scoped-admin", organizationId: "scope-org-a", roles: [{ roleId: "admin", projectId: "scope-project-a" }], projects: 2, current: 3 },
  { id: "scoped-platform", organizationId: "scope-org-a", roles: [{ roleId: "platform-admin", projectId: "scope-project-a" }], projects: 2, current: 3 },
  { id: "mixed", organizationId: "scope-org-a", roles: [{ roleId: "guest", projectId: null }, { roleId: "software-user", projectId: "scope-project-a" }], projects: 2, current: 3 },
  { id: "other-org", organizationId: "scope-org-b", roles: [{ roleId: "software-user", projectId: "scope-project-c" }], projects: 1, current: 4 },
  { id: "no-role", organizationId: "scope-org-a", roles: [], projects: 0, current: 0 },
];

describe("R2-SCOPE actual role bindings → root HTTP → PostgreSQL usage", () => {
  let database: ParameterCatalogDatabase;
  let root: RootDatabase;
  let server: Server;
  let baseUrl: string;
  let releaseId: string;
  let measuring = false;
  let businessSql: string[] = [];
  let usageParameters: { definitions: unknown; projects: unknown }[] = [];
  const records: unknown[] = [];
  const actualRoleBindings = new Map<string, unknown>();

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("r2scope");
    root = createPostgresDatabase(database.url);
    const pool = getRootPostgresPool(root);
    if (!pool) throw new Error("real PostgreSQL pool required");
    pool.on("connect", (client) => {
      const query = client.query;
      client.query = function (...args: Parameters<typeof query>) {
        const input = args[0];
        const sql = typeof input === "string" ? input : input && "text" in input ? String(input.text) : "";
        if (measuring && /parameter_catalog\.(organization_subject_registrations|subject_placements|parameter_review_evidence|parameter_review_items|project_parameter_bindings|project_parameter_values)\b/.test(sql)) {
          businessSql.push(sql);
          if (/from parameter_catalog\.project_parameter_bindings binding/.test(sql)) {
            const values = args[1] as unknown;
            usageParameters.push({ definitions: Array.isArray(values) ? values[1] : undefined, projects: Array.isArray(values) ? values[3] : undefined });
          }
        }
        return Reflect.apply(query, this, args);
      } as typeof query;
    });
    const bundle = firstReleaseBundle();
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
      await pool.query("insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id) values ($1,$2,'Scope driver',$1,1,'driver-group','curated',$3)", [`module-${organizationId}`, organizationId, `attr-${organizationId}`]);
      const registration = await createRegistrationService(pool).execute({ kind: "register", organizationId, subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver", expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: `module-${organizationId}`, method: "explicit", proof: { reason: "scope fixture" }, idempotencyKey: `registration-${organizationId}`, context: { actorKind: "org-admin", principalId: `fixture-${organizationId}` } });
      if (!registration.ok) throw new Error(`fixture registration failed: ${JSON.stringify(registration.error)}`);
      // Independent distribution: A=1 current, B=2 current, other-org C=4 current.
      // Every real binding has two history entries; each project also has a placeholder.
      const projects = organizationId === "scope-org-a" ? [["scope-project-a", 1], ["scope-project-b", 2]] as const : [["scope-project-c", 4]] as const;
      for (const [projectId, currentCount] of projects) {
        for (let index = 0; index <= currentCount; index += 1) {
          const binding = await stabilizeCanonicalBinding(pool, { snapshot: loaded.value, organizationId, projectId, logicalNodeId: `${projectId}-node-${index}`, registrationId: registration.value.registrationId, definitionId, effectiveRevisionId: revisionId, expectedEffectiveRevisionId: null });
          if (!binding.ok) throw new Error("fixture binding failed");
          let expectedTip = binding.value.binding.currentValueId;
          for (let revision = 1; index < currentCount && revision <= 2; revision += 1) {
            const appended = await appendProjectValue(pool, { snapshot: loaded.value, binding: binding.value.binding, definitionRevisionId: revisionId, source: { sourceRef: `config-set:${projectId}-${index}`, configRevisionId: `scope-revision-${revision}` }, payload: { kind: "number", value: 1000 + revision }, expectedTip });
            if (!appended.ok) throw new Error("fixture append failed");
            expectedTip = appended.value.currentTip;
          }
        }
      }
    }
    server = createWiseEffServer({ db: root, auth: { mode: "production", verifier: { verify: async (authorization): Promise<AuthContext> => {
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
    const directory = process.env.WISEEFF_CATALOG_SCOPE_EVIDENCE_DIR;
    if (directory) {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "scope-results.json"), JSON.stringify(records, null, 2));
    }
  });

  it.each(actors.filter((actor) => actor.id !== "no-role"))("R2-SCOPE-01 $id retains only authorized project counts in list and detail", async (actor) => {
    const headers = { authorization: `Bearer scope-${actor.id}` };
    businessSql = [];
    usageParameters = [];
    measuring = true;
    const listed = await fetch(`${baseUrl}/api/v2/catalog/definitions?registration=active&limit=25`, { headers });
    const body = await listed.json();
    measuring = false;
    const item = body.items?.find((entry: { id: string }) => entry.id === definitionId);
    records.push({ actor: actor.id, actualDatabaseRoleBindings: actualRoleBindings.get(actor.id), organizationId: actor.organizationId, expected: { projectCount: actor.projects, currentValueCount: actor.current }, actual: item?.usageSummary, status: listed.status, businessQueryCount: businessSql.length, usageParameters });
    expect(listed.status).toBe(200);
    expect(item?.usageSummary).toMatchObject({ projectCount: actor.projects, currentValueCount: actor.current });
    expect(businessSql).toHaveLength(5);
    expect(usageParameters).toHaveLength(1);
    const detail = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}`, { headers });
    expect(detail.status).toBe(200);
    expect((await detail.json()).item).toEqual(item);
    const named = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}`, { headers: { ...headers, "X-WiseEff-Catalog-Release": releaseId } });
    expect(named.status).toBe(200);
    expect((await named.json()).item.usageSummary).toEqual(item.usageSummary);
    // One installed release: named=current, not historical-release evidence.
    expect(getRootPostgresPool(root)?.waitingCount).toBe(0);
  });

  it("R2-SCOPE-02 request fields cannot widen the actual database project binding", async () => {
    const response = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}`, { headers: { authorization: "Bearer scope-only-a", "X-Role": "admin", "X-Project-Id": "scope-project-b", "X-Project-Scope": "all", "X-Actor-Kind": "platform-admin" } });
    expect(response.status).toBe(200);
    expect((await response.json()).item.usageSummary).toMatchObject({ projectCount: 1, currentValueCount: 1 });
  });

  it("R2-SCOPE-03 identity-provider admin claims without a database grant do not permit a read", async () => {
    const response = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}`, { headers: { authorization: "Bearer scope-no-role" } });
    expect(response.status).toBe(401);
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

  it("R2-SCOPE-05 refreshed database bindings replace the previous request's project scope", async () => {
    const pool = getRootPostgresPool(root);
    if (!pool) throw new Error("real PostgreSQL pool required");
    await pool.query("update public.user_role_bindings set project_id='scope-project-b' where id='scope-role-only-a-0'");
    try {
      const response = await fetch(`${baseUrl}/api/v2/catalog/definitions/${definitionId}`, { headers: { authorization: "Bearer scope-only-a" } });
      expect(response.status).toBe(200);
      expect((await response.json()).item.usageSummary).toMatchObject({ projectCount: 1, currentValueCount: 2 });
    } finally {
      await pool.query("update public.user_role_bindings set project_id='scope-project-a' where id='scope-role-only-a-0'");
    }
  });
});

describe("R2-SCOPE controlled composition rejection, pure boundary evidence", () => {
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
