import pg from "pg";
import { expect, it } from "vitest";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createUserInvocation, createAgentInvocation } from "../../auth/trustedInvocation";
import { firstAcmePredecessor } from "../../catalog-publication/builder/predecessorHarness";
import { refreshAuthoritativeSource } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../../catalog-kernel/compiler";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease, createCatalogInstaller } from "../../catalog-kernel/install/installer";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import { adoptPreexistingCatalog } from "../../catalog-publication/runtime/adoption";
import { enablePublicationPolicy } from "../../catalog-publication/authorization/testHarness";
import { runPublicationManagerOnce } from "../../catalog-publication/jobs/manager";
import { CatalogReleaseDigest } from "../../parameter-catalog-contract";
import { catalogClaimedOwnersResponseSchema, catalogPublicationJobResponseSchema } from "../../contracts/dtoSchemas/parameterCatalog";
import { bindCatalogPublicationCommands } from "./ports";
import { listenCatalogPublicationHttpServer } from "./http";
import type { TrustedPublicationScope } from "./types";

it("publishes only claimed owners through authenticated HTTP and the real manager, retaining identities", async () => {
  const lane = await createEphemeralTestDatabase("claimed-owner-publication");
  const db = createPostgresDatabase(lane.url), pool = getRootPostgresPool(db)!;
  const client = new pg.Client({ connectionString: lane.url });
  let close = async () => {};
  try {
    await client.connect();
    const first = firstAcmePredecessor();
    const template = first.first.documents.find(document => document.kind === "subject")!;
    const node = (id: string) => ({ ...template, kind: "subject" as const, content: {
      id, kind: "node-type" as const, canonicalKey: `node-type:${id}`, lifecycle: "active" as const,
      selector: { kind: "node-type-name" as const, value: id, provenance: { source: "owner-publication-test" } },
      subtype: {}, tombstone: null,
    } });
    const release = { ...structuredClone(first.first), documents: [...first.first.documents, node("claimed_child"), node("unclaimed_child")] };
    refreshAuthoritativeSource(release as Parameters<typeof refreshAuthoritativeSource>[0]);
    const bundle = { ...first.bundle, releases: [release] };
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled));
    expect((await installPublishedRelease(pool, { mode: "bootstrap", source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.value.aggregateDigest })).ok).toBe(true);
    const bytes = Buffer.from(JSON.stringify(bundle));
    const pin = { id: compiled.value.release.id, digest: CatalogReleaseDigest(compiled.value.aggregateDigest) };
    const verification = await pool.query<{ compiled_fingerprint: string }>(
      "select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id=$1", [pin.id]);
    expect((await adoptPreexistingCatalog(pool, { expectedCurrent: pin, actorPrincipalId: "owner-publisher",
      sourceBytes: bytes, artifactDigest: pin.digest, evidenceKind: "synthetic-fixture", adoptionEvidence: {
        source_bundle_digest: pin.digest, verification_digest: verification.rows[0]!.compiled_fingerprint,
        data_mode: "fresh", collected_at: new Date().toISOString(), approved_by: "owner-publisher" } })).ok).toBe(true);
    await enablePublicationPolicy(client, { publicationEnabled: true, lowRiskSingleActorPublish: false });
    const auth = makeTestAuthContext({ userId: "owner-publisher", organizationId: "owner-org", roleId: "admin",
      permissions: ["catalog:author", "catalog:publish", "catalog:review-high-risk"] });
    const admin: TrustedPublicationScope = { principalId: auth.user.id, organizationId: auth.organization.id,
      actorKind: "org-admin", permissions: auth.permissions, trustedActor: createUserInvocation(auth) };
    let scope = admin;
    let releaseId: string = compiled.value.release.id;
    const server = await listenCatalogPublicationHttpServer({ ...bindCatalogPublicationCommands({ db, pool }),
      authenticate: async () => ({ ok: true, scope }), currentRelease: async () => {
        const pointer = await readCurrentCatalogPointer(pool);
        return pointer.kind === "installed" ? pointer.current : null;
      } });
    close = server.close;
    const request = async (method: string, path: string, body?: unknown, pin = releaseId) => {
      const response = await fetch(server.baseUrl + "/api/v2/catalog/" + path, { method,
        headers: { "content-type": "application/json", "X-WiseEff-Catalog-Release": pin },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    const preview = () => request("POST", "publication-candidates", { claimedOwners: true });
    expect(await preview()).toMatchObject({ status: 200, body: { item: { candidate: null, noChange: true } } });
    await db.query("select parameter_catalog.claim_catalog_subject_owner('claimed_child','csub_acme_power')");
    const before = (await db.query(`select jsonb_agg(to_jsonb(s) order by id) as data from parameter_catalog.catalog_subjects s`)).rows;
    expect((await request("POST", "publication-candidates", { claimedOwners: true, ownerSubjectId: "forged" })).status).toBe(400);
    expect((await request("POST", "publication-candidates", { changeSet: [{ op: "declare-subject-owner", subjectId: "unclaimed_child", ownerSubjectId: "csub_acme_power" }] })).status).toBe(400);
    expect((await request("POST", "publication-candidates", { claimedOwners: true }, "stale-release")).status).toBe(409);
    scope = { ...admin, permissions: ["catalog:publish"] };
    expect((await preview()).status).toBe(403);
    scope = { ...admin, actorKind: "agent", trustedActor: createAgentInvocation(auth, { sessionId: "test", toolCallId: "test", approval: { required: true, approvalId: "test" } }) };
    expect((await preview()).status).toBe(403);
    scope = admin;
    const result = await preview();
    expect(result.status).toBe(201);
    const candidate = catalogClaimedOwnersResponseSchema.parse(result.body).item.candidate!;
    expect(candidate).toMatchObject({ riskClass: "high", capabilityContract: { revision: "catalog-capability/v6" },
      impactSummary: { addedDefinitionCount: 0, changedDefinitionCount: 0, addedSubjectCount: 0,
        ownerPublicationOnly: true, ownerDeclarations: [{ subjectId: "claimed_child", ownerSubjectId: "csub_acme_power" }] } });
    expect(candidate.impactSummary.ownerDeclarations).toHaveLength(1);
    scope = { ...admin, organizationId: "another-org" };
    expect((await request("GET", `publication-candidates/${candidate.id}`)).status).toBe(404);
    expect((await request("POST", `publication-candidates/${candidate.id}/publish`, { idempotencyKey: "owner-publication" })).status).toBe(404);
    scope = admin;
    const submitted = await request("POST", `publication-candidates/${candidate.id}/publish`, { idempotencyKey: "owner-publication" });
    expect(submitted.status).toBe(201);
    const job = catalogPublicationJobResponseSchema.parse(submitted.body).item;
    expect((await request("POST", `publication-candidates/${candidate.id}/publish`, { idempotencyKey: "owner-publication" })).body).toMatchObject({ item: { id: job.id } });
    expect(await runPublicationManagerOnce({ db, pool, installer: createCatalogInstaller(pool),
      resolvePublisherActor: async () => admin.trustedActor, ownerId: "owner-publication-manager" })).toBe("claimed");
    expect((await request("GET", `publications/${job.id}`)).body).toMatchObject({
      error: { details: { reason: "release-drift" } },
    });
    const pointer = await readCurrentCatalogPointer(pool);
    if (pointer.kind !== "installed") throw new Error("missing published release");
    expect(pointer.current.id).not.toBe(releaseId);
    releaseId = pointer.current.id;
    const finished = await request("GET", `publications/${job.id}`);
    expect(finished.status).toBe(200);
    expect(finished.body).toMatchObject({ item: { effective: true, isCurrent: true, currentness: "active" } });
    expect(await preview()).toMatchObject({ status: 200, body: { item: { candidate: null, noChange: true } } });
    expect((await db.query(`select jsonb_agg(to_jsonb(s) order by id) as data from parameter_catalog.catalog_subjects s`)).rows).toEqual(before);
    expect((await db.query(`select owner_subject_id from parameter_catalog.catalog_subjects where id='unclaimed_child'`)).rows[0]).toEqual({ owner_subject_id: null });
  } finally { await close(); await client.end(); await db.close(); await lane.drop(); }
}, 120_000);
