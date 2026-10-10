import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../../app";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../../testing/parameterCatalog";
import { insertDtsObservationSourceFixture } from "../../../testing/parameterCatalog/dtsObservationSource";
import type { AuthContext } from "../../auth/types";
import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../catalog-publication/runtime/provisionRuntimeLogins";
import { CatalogReleaseId, type CatalogReleasePin, type ContractJsonValue } from "../../parameter-catalog-contract/index";
import { createEvidenceIngest, planEvidenceIngest, type IngestEvidenceCommand } from "../../parameter-governance/evidence/index";
import { createReviewQueueReader } from "../../parameter-governance/review/index";

const ORG = "review-closure-org";
const OTHER_ORG = "review-closure-other";
const MATCHER = "review-closure-fixture-matcher";

describe("Review Queue closed item through authenticated root HTTP", () => {
  let database: ParameterCatalogDatabase;
  let root: RootDatabase;
  let api: RootDatabase;
  let roleToken: string;
  let pool: pg.Pool;
  let server: Server;
  let baseUrl: string;
  let pin: CatalogReleasePin;
  let historicalReleaseId: string;

  const ingestFixture = async (command: IngestEvidenceCommand, observationId?: string) => {
    if (!observationId) {
      const result = await createEvidenceIngest(pool).ingest(command);
      if (!result.ok) throw new Error("Review evidence fixture was not ingested");
      return result.value.id;
    }
    const planned = planEvidenceIngest(command);
    if (!planned.ok || planned.value.kind !== "review-evidence") throw new Error("Review evidence fixture was not planned");
    const evidenceId = `prev_${randomUUID()}`;
    await pool.query(`insert into parameter_catalog.parameter_review_evidence
      (id,organization_id,observation_id,reason,candidate_safe_digest,evidence)
      values ($1,$2,$3,$4,$5,$6::jsonb)`, [evidenceId, ORG, observationId, planned.value.reason,
      planned.value.fingerprint, JSON.stringify(planned.value.evidence)]);
    return evidenceId;
  };

  const request = async (actor: "admin" | "member" | "other", method: string, path: string, init: { headers?: Record<string, string>; body?: unknown } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer review-closure-${actor}`, "content-type": "application/json", ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as Record<string, any> };
  };

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("reviewclosure");
    root = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(root)!;
    const bundle = validCatalogReleaseBundle();
    historicalReleaseId = bundle.releases[0]!.manifest.release.id;
    const firstBundle = { schemaVersion: bundle.schemaVersion, targetReleaseId: historicalReleaseId, releases: [structuredClone(bundle.releases[0]!)] };
    const firstCompiled = compileCatalogRelease(firstBundle);
    if (!firstCompiled.ok) throw new Error(JSON.stringify(firstCompiled.error));
    const firstInstalled = await installPublishedRelease(pool, {
      mode: "bootstrap", source: jsonCatalogReleaseSource(firstBundle), expectedTargetDigest: firstCompiled.value.aggregateDigest,
    });
    if (!firstInstalled.ok) throw new Error(JSON.stringify(firstInstalled.error));
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const installed = await installPublishedRelease(pool, {
      mode: "advance", source: jsonCatalogReleaseSource(bundle),
      expectedCurrent: { id: firstCompiled.value.release.id, digest: firstCompiled.value.release.digest },
      expectedTargetDigest: compiled.value.aggregateDigest,
    });
    if (!installed.ok) throw new Error(JSON.stringify(installed.error));
    pin = { id: compiled.value.release.id, digest: compiled.value.release.digest };
    await pool.query("insert into public.organizations(id,name) values ($1,'Review closure'),($2,'Other')", [ORG, OTHER_ORG]);
    for (const [actor, org, role] of [["admin", ORG, "admin"], ["member", ORG, "software-user"], ["other", OTHER_ORG, "admin"]] as const) {
      await pool.query("insert into public.users(id,organization_id,name,email,title,is_active) values ($1,$2,$1,$3,'Review fixture',true)", [actor, org, `${actor}@review.test`]);
      await pool.query("insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id) values ($1,$2,$3,null,$4)", [`role-${actor}`, actor, org, role]);
    }
    for (const [owner, organizationId] of [["own", ORG], ["foreign", OTHER_ORG], ["other", ORG]] as const) {
      await pool.query("insert into projects(id,organization_id,name,code) values ($1,$2,$1,$1)", [`${owner}-project`, organizationId]);
      await pool.query("insert into dts_config_set(id,organization_id,project_id,name) values ($1,$2,$3,$1)", [`${owner}-set`, organizationId, `${owner}-project`]);
      await pool.query(`insert into project_parameter_files(id,organization_id,project_id,file_name,format,config_set_id)
        values ($1,$2,$3,'board.dts','dts',$4)`, [`${owner}-file`, organizationId, `${owner}-project`, `${owner}-set`]);
      await pool.query(`insert into project_parameter_file_versions(id,file_id,version_number,storage_key,checksum,size_bytes,origin)
        values ($1,$2,1,$1,$1,1,'upload')`, [`${owner}-version`, `${owner}-file`]);
      await pool.query(`insert into dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status)
        values ($1,$2,$3,$4,1,'resolved')`, [`${owner}-revision`, organizationId, `${owner}-project`, `${owner}-set`]);
      await pool.query(`insert into dts_config_revision_members(id,config_revision_id,file_id,file_version_id,role,sort_order)
        values ($1,$2,$3,$4,'base',0)`, [`${owner}-member`, `${owner}-revision`, `${owner}-file`, `${owner}-version`]);
      await pool.query(`insert into dts_logical_nodes(id,organization_id,project_id,config_set_id)
        values ($1,$2,$3,$4)`, [`${owner}-logical`, organizationId, `${owner}-project`, `${owner}-set`]);
      await pool.query(`insert into dts_logical_node_revisions(id,logical_node_id,config_revision_id,node_locator,name)
        values ($1,$2,$3,'/charger','charger')`, [`${owner}-logical-revision`, `${owner}-logical`, `${owner}-revision`]);
      await pool.query(`insert into dts_node_occurrences(id,config_revision_id,file_version_id,name,node_path,
        start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text)
        values ($1,$2,$3,'charger','/charger',0,10,1,1,1,11,'charger {}')`, [`${owner}-node`, `${owner}-revision`, `${owner}-version`]);
      await pool.query(`insert into dts_property_occurrences(id,config_revision_id,node_occurrence_id,file_version_id,property_name,
        start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text)
        values ($1,$2,$3,$4,'limit',1,8,1,2,1,9,'limit=1')`, [`${owner}-property`, `${owner}-revision`, `${owner}-node`, `${owner}-version`]);
      await pool.query(`insert into dts_occurrence_effects(id,config_revision_id,logical_node_revision_id,property_name,effect_kind,
        node_occurrence_id,property_occurrence_id,source_order) values ($1,$2,$3,'limit','set',$4,$5,0)`,
      [`${owner}-effect`, `${owner}-revision`, `${owner}-logical-revision`, `${owner}-node`, `${owner}-property`]);
    }
    await pool.query(`insert into dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status)
      values ('own-inconsistent-revision',$1,'own-project','own-set',2,'resolved')`, [ORG]);
    for (const [observationId, owner, catalogReleaseId] of [
      ["own-observation", "own", pin.id], ["other-observation", "other", pin.id],
      ["historical-observation", "own", historicalReleaseId],
    ]) {
      await insertDtsObservationSourceFixture(pool, { organizationId: ORG, projectId: `${owner}-project`,
        configSetId: `${owner}-set`, fileId: `${owner}-file`, logicalNodeId: `${owner}-logical`,
        configRevisionId: `${owner}-revision`, occurrenceId: `${owner}-occurrence`, observationId: observationId!,
        catalogReleaseId: catalogReleaseId!, locator: { kind: "dts-property", fileVersionId: `${owner}-version`,
          nodeOccurrenceId: `${owner}-node`, propertyOccurrenceId: `${owner}-property`, propertyName: "limit" } });
    }
    roleToken = `reviewevidence${randomBytes(5).toString("hex")}`;
    const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: roleToken });
    api = createPostgresDatabase(runtime.apiUrl);
    expect((await api.query(`select current_user,rolsuper from pg_roles where rolname=current_user`)).rows)
      .toEqual([{ current_user: runtime.apiRole, rolsuper: false }]);
    server = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async (authorization): Promise<AuthContext> => {
      const actor = authorization?.replace("Bearer review-closure-", "");
      if (actor !== "admin" && actor !== "member" && actor !== "other") throw new Error("invalid fixture token");
      const organizationId = actor === "other" ? OTHER_ORG : ORG;
      return { user: { id: actor, organizationId, name: actor, email: `${actor}@review.test`, emailVerified: true, title: "Review fixture", isActive: true }, organization: { id: organizationId, name: organizationId }, roles: [{ roleId: "admin", projectId: null }], permissions: ["parameter:view"] };
    } } } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 180_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await api?.close();
    if (roleToken && database) await dropLabRuntimeLogins(database.url, roleToken);
    await root?.close();
    await database?.close();
  });

  it.each<[string, Record<string, ContractJsonValue>, string?]>([
    ["foreign project", { projectId: "foreign-project" }],
    ["foreign revision", { configRevisionId: "foreign-revision" }],
    ["foreign property occurrence", { propertyOccurrenceId: "foreign-property" }],
    ["foreign logical node", { logicalNodeId: "foreign-logical" }],
    ["inconsistent own revision", { configRevisionId: "own-inconsistent-revision" }],
    ["dangling evidence", { configRevisionId: "absent-revision", propertyOccurrenceId: "absent-property", logicalNodeId: "absent-node" }],
    ["foreign source revision", { sourceRevision: { projectId: "foreign-project", configRevisionId: "foreign-revision", logicalNodeId: "foreign-logical" } }],
    ["foreign source proof", { sourceProof: { configRevisionId: "foreign-revision", propertyOccurrenceId: "foreign-property", logicalNodeId: "foreign-logical" } }],
    ["inconsistent source proof", { sourceProof: { configRevisionId: "own-revision", propertyOccurrenceId: "foreign-property", logicalNodeId: "own-logical" } }],
    ["malformed source proof", { sourceProof: "not-a-source-proof" }],
    ["foreign proof file version", { sourceProof: { configRevisionId: "own-revision", propertyOccurrenceId: "own-property", logicalNodeId: "own-logical", fileVersionId: "foreign-version" } }],
    ["foreign proof node occurrence", { sourceProof: { configRevisionId: "own-revision", propertyOccurrenceId: "own-property", logicalNodeId: "own-logical", nodeOccurrenceId: "foreign-node" } }],
    ["inconsistent proof property name", { sourceProof: { configRevisionId: "own-revision", propertyOccurrenceId: "own-property", logicalNodeId: "own-logical", propertyName: "different-property" } }],
    ["foreign proof config set", { sourceRevision: { configRevisionId: "own-revision", logicalNodeId: "own-logical", configSetId: "foreign-set" } }],
    ["foreign proof logical revision", { sourceRevision: { configRevisionId: "own-revision", logicalNodeId: "own-logical", logicalNodeRevisionId: "foreign-logical-revision" } }],
    ["linked different graph", { projectId: "other-project", configRevisionId: "other-revision", propertyOccurrenceId: "other-property", logicalNodeId: "other-logical" }, "own-observation"],
    ["linked release mismatch", {}, "historical-observation"],
    ["linked matcher mismatch", {}, "own-observation"],
    ["contradictory sibling proofs", { sourceRevision: { projectId: "own-project", configRevisionId: "own-revision", logicalNodeId: "own-logical" },
      sourceProof: { configRevisionId: "other-revision", propertyOccurrenceId: "other-property", logicalNodeId: "other-logical" } }],
  ])("rejects authorized Review resolution with %s evidence without domain writes", async (vector, overrides, observationId) => {
    const flatReferences: Record<string, ContractJsonValue> = vector === "contradictory sibling proofs" ? {} : { projectId: "own-project",
      configRevisionId: "own-revision", propertyOccurrenceId: "own-property", logicalNodeId: "own-logical" };
    const evidenceId = await ingestFixture({ organizationId: ORG, sourceIdentity: `negative:${randomUUID()}`,
      catalogReleaseId: pin.id, matcherRevision: observationId && vector !== "linked matcher mismatch" ? "matcher-d897" : `tenant-evidence:${vector}`, matcherOutput: { status: "unknown" },
      evidence: { ...flatReferences, propertyKey: vector, compatible: "vendor,device", ...overrides } }, observationId);
    const path = `/api/v2/organizations/${ORG}/parameter-review-items`;
    const queue = await request("admin", "GET", path);
    expect(queue.status).toBe(200);
    const item = queue.body.items.find((entry: { observation?: { id: string } }) => entry.observation?.id === evidenceId);
    expect(item?.status).toBe("open");
    const counts = async () => (await pool.query(`select
      (select count(*)::int from parameter_catalog.organization_subject_registrations) as registrations,
      (select count(*)::int from parameter_catalog.subject_placements) as placements,
      (select count(*)::int from parameter_catalog.project_parameter_bindings) as bindings,
      (select count(*)::int from parameter_catalog.project_parameter_values) as values,
      (select count(*)::int from parameter_catalog.definition_proposals) as proposals,
      (select count(*)::int from parameter_catalog.parameter_review_resolutions) as resolutions,
      (select count(*)::int from parameter_catalog.governance_command_idempotency) as commands,
      (select count(*)::int from audit_events where action <> 'review-resolution-refused') as audits`)).rows[0];
    const before = await counts();
    const result = await request("admin", "POST", `${path}/${item.id}/resolve`, {
      headers: { "X-WiseEff-Catalog-Release": pin.id, "Idempotency-Key": `reject:${randomUUID()}`, "If-Match": `"${item.etag}"` },
      body: { resolution: { type: "mark-out-of-scope" }, reason: "review malformed source evidence" },
    });
    expect.soft(result.status, JSON.stringify(result.body)).toBe(400);
    expect.soft((await pool.query("select status,current_resolution_id,etag_version from parameter_catalog.parameter_review_items where id=$1", [item.id])).rows)
      .toEqual([{ status: "open", current_resolution_id: null, etag_version: "1" }]);
    expect.soft(await counts()).toEqual(before);
    expect.soft((await pool.query("select count(*)::int as count from audit_events where target_id=$1 and action='review-resolution-refused'", [item.id])).rows[0]?.count).toBe(1);
  });

  it("does not re-project an out-of-scope item as open while a sibling stays open", async () => {
    const ingest = createEvidenceIngest(pool);
    for (const propertyKey of ["closed-key", "closed-key", "sibling-key"]) {
      const result = await ingest.ingest({ organizationId: ORG, sourceIdentity: `source:${randomUUID()}`, catalogReleaseId: pin.id,
        matcherRevision: MATCHER, matcherOutput: { status: "unknown" }, evidence: { propertyKey, compatible: "vendor,device" }, provenance: null });
      expect(result.ok).toBe(true);
    }
    const historical = await ingest.ingest({ organizationId: ORG, sourceIdentity: `source:${randomUUID()}`, catalogReleaseId: CatalogReleaseId(historicalReleaseId),
      matcherRevision: MATCHER, matcherOutput: { status: "unknown" }, evidence: { propertyKey: "closed-key", compatible: "vendor,device" }, provenance: null });
    expect(historical.ok).toBe(true);
    expect(historicalReleaseId).not.toBe(pin.id);
    const path = `/api/v2/organizations/${ORG}/parameter-review-items`;
    const before = await request("admin", "GET", path);
    expect(before.status).toBe(200);
    const closed = before.body.items.find((item: { observation?: { propertyKey: string } }) => item.observation?.propertyKey === "property:closed-key");
    const sibling = before.body.items.find((item: { observation?: { propertyKey: string } }) => item.observation?.propertyKey === "property:sibling-key");
    expect(closed?.candidates).toHaveLength(2);
    expect(sibling?.status).toBe("open");
    const count = async () => (await pool.query<{ count: number }>(
      "select count(distinct id)::int as count from parameter_catalog.parameter_review_items where organization_id=$1 and catalog_release_id=$2 and status='out-of-scope'", [ORG, pin.id],
    )).rows[0]!.count;
    const reader = createReviewQueueReader(pool);
    const queueQuery = { organizationId: ORG, capturedRelease: pin,
      context: { actorKind: "org-admin" as const, principalId: "admin", organizationId: ORG } };
    expect(before.body.items[0].candidateState.capturedRelease).toEqual(pin);
    expect(await count()).toBe(0);
    const beforeQuery = await reader.list(queueQuery);
    expect(beforeQuery.ok && beforeQuery.value.ignoredReviewItemCount).toBe(0);

    const resolveHeaders = { "X-WiseEff-Catalog-Release": pin.id, "Idempotency-Key": `ignore:${randomUUID()}`, "If-Match": `"${closed.etag}"` };
    const resolved = await request("admin", "POST", `${path}/${closed.id}/resolve`, {
      headers: resolveHeaders,
      body: { resolution: { type: "mark-out-of-scope" }, reason: "reviewed irrelevant observation" },
    });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    const replay = await request("admin", "POST", `${path}/${closed.id}/resolve`, {
      headers: resolveHeaders,
      body: { resolution: { type: "mark-out-of-scope" }, reason: "reviewed irrelevant observation" },
    });
    expect(replay.status).toBe(200);
    const repeated = await ingest.ingest({ organizationId: ORG, sourceIdentity: `source:${randomUUID()}`, catalogReleaseId: pin.id,
      matcherRevision: MATCHER, matcherOutput: { status: "unknown" }, evidence: { propertyKey: "closed-key", compatible: "vendor,device" }, provenance: null });
    expect(repeated.ok).toBe(true);
    const differentMatcher = await ingest.ingest({ organizationId: ORG, sourceIdentity: `source:${randomUUID()}`, catalogReleaseId: pin.id,
      matcherRevision: `${MATCHER}-next`, matcherOutput: { status: "unknown" }, evidence: { propertyKey: "closed-key", compatible: "vendor,device" }, provenance: null });
    expect(differentMatcher.ok).toBe(true);
    const stored = (await pool.query("select id,evidence_fingerprint,catalog_release_id,matcher_revision,status,etag_version,current_resolution_id from parameter_catalog.parameter_review_items where organization_id=$1 order by id", [ORG])).rows;
    const audits = (await pool.query("select id,action,organization_id from public.audit_events where organization_id=$1 and action='review-item-resolved'", [ORG])).rows;
    const refreshed = await request("admin", "GET", path);
    const detail = await request("admin", "GET", `${path}/${closed.id}`);
    if (process.env.WISEEFF_REVIEW_CLOSURE_PROOF === "1") {
      console.log("REVIEW_CLOSURE_PROOF", JSON.stringify({ pin, before: before.body.items.map((item: { id: string; status: string }) => ({ id: item.id, status: item.status })),
        stored, audits, after: refreshed.body.items.map((item: { id: string; status: string }) => ({ id: item.id, status: item.status })),
        detailStatus: detail.status, ignoredReviewItemCount: await count() }));
    }
    expect(stored.find((item: { id: string }) => item.id === closed.id)?.status).toBe("out-of-scope");
    expect(audits).toHaveLength(1);
    expect(await count()).toBe(1);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.items.find((item: { id: string }) => item.id === closed.id)).toBeUndefined();
    expect(refreshed.body.items.find((item: { id: string }) => item.id === sibling.id)?.status).toBe("open");
    expect(refreshed.body.items.filter((item: { observation?: { propertyKey: string } }) => item.observation?.propertyKey === "property:closed-key")).toHaveLength(1);
    const afterQuery = await reader.list(queueQuery);
    expect(afterQuery.ok && afterQuery.value.ignoredReviewItemCount).toBe(1);
    expect(afterQuery.ok && afterQuery.value.items.some((item) => item.id === closed.id)).toBe(false);
    const otherQuery = await reader.list({ ...queueQuery, organizationId: OTHER_ORG,
      context: { actorKind: "org-admin", principalId: "other", organizationId: OTHER_ORG } });
    expect(otherQuery.ok && otherQuery.value.ignoredReviewItemCount).toBe(0);
    expect(detail.status).toBe(404);
    expect((await request("member", "GET", path)).status).toBe(403);
    expect((await request("other", "GET", path)).status).toBe(404);
  });

  it.each(["direct", "sourceRevision", "sourceProof", "linked", "paired"])("resolves %s evidence with an exact same-tenant source graph", async (shape) => {
    const references = { configRevisionId: "own-revision", propertyOccurrenceId: "own-property", logicalNodeId: "own-logical",
      fileVersionId: "own-version", nodeOccurrenceId: "own-node", propertyName: "limit", configSetId: "own-set",
      logicalNodeRevisionId: "own-logical-revision", fileId: "own-file", nodeLocator: "/charger" };
    const evidenceId = await ingestFixture({ organizationId: ORG, sourceIdentity: `valid:${randomUUID()}`,
      catalogReleaseId: pin.id, matcherRevision: shape === "linked" ? "matcher-d897" : `tenant-evidence:valid:${shape}`, matcherOutput: { status: "unknown" },
      evidence: { propertyKey: `valid:${shape}`, compatible: "vendor,device", ...(shape === "direct" || shape === "linked"
        ? { projectId: "own-project", ...references }
        : shape === "paired" ? { sourceRevision: { projectId: "own-project", ...references }, sourceProof: references }
          : { [shape]: shape === "sourceProof" ? references : { projectId: "own-project", ...references } }) } }, shape === "linked" ? "own-observation" : undefined);
    const path = `/api/v2/organizations/${ORG}/parameter-review-items`;
    const queue = await request("admin", "GET", path);
    expect(queue.status).toBe(200);
    const item = queue.body.items.find((entry: { observation?: { id: string } }) => entry.observation?.id === evidenceId);
    expect(item?.status).toBe("open");
    const result = await request("admin", "POST", `${path}/${item.id}/resolve`, {
      headers: { "X-WiseEff-Catalog-Release": pin.id, "Idempotency-Key": `valid:${randomUUID()}`, "If-Match": `"${item.etag}"` },
      body: { resolution: { type: "mark-out-of-scope" }, reason: "valid source reviewed" },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect((await pool.query("select status from parameter_catalog.parameter_review_items where id=$1", [item.id])).rows)
      .toEqual([{ status: "out-of-scope" }]);
    expect((await pool.query("select count(*)::int as count from audit_events where target_id=$1 and action='review-item-resolved'", [item.id])).rows[0]?.count).toBe(1);
  });
});
