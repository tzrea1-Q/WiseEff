import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createApiParameterCatalogGovernanceRepository } from "../../../../src/application/parameter-catalog/apiAdapter";
import { proposalContractVectors } from "../../../../src/application/parameter-catalog/proposalContractVectors";
import { createParameterCatalogClient } from "../../../../src/infrastructure/http/parameterCatalogClient";
import { createWiseEffServer } from "../../../app";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../../testing/parameterCatalog";
import { installPublishedCatalogChain, X_DEFINITION_ID, X_REVISION_2 } from "../../catalog-kernel/runtime/catalogChain.fixture";
import { setProposalWriterTestHooks } from "../../parameter-governance/proposals/writer";

const ORG_ID = "org-r2-prop";
const AUTHOR_ID = "user-r2-prop-author";

describe("R2 Proposal shared operation vectors: actual API adapter, root HTTP and PostgreSQL", () => {
  let database: ParameterCatalogDatabase;
  let root: RootDatabase;
  let server: Server;
  let baseUrl: string;
  let releaseId: string;
  let actor = "author";
  const client = () => createParameterCatalogClient({ baseUrl, getAuthorization: () => `Bearer r2-proposal-${actor}` });
  const setActor = async (next: string) => {
    actor = next;
    const pool = getRootPostgresPool(root)!;
    await pool.query("update public.user_role_bindings set role_id = $1 where id = 'urb-r2-prop-author'", [next === "guest" ? "guest" : next === "self-reviewer" ? "platform-admin" : "admin"]);
    await pool.query("update public.users set is_active = $1 where id = $2", [next !== "inactive", AUTHOR_ID]);
  };
  const evidence = async () => {
    const pool = getRootPostgresPool(root)!;
    return (await pool.query(`select
      (select jsonb_agg(jsonb_build_array(id,status,etag_version) order by id) from parameter_catalog.definition_proposals) as proposals,
      (select count(*)::int from parameter_catalog.definition_proposal_revisions) as revisions,
      (select count(*)::int from parameter_catalog.catalog_publication_intents) as intents,
      (select count(*)::int from parameter_catalog.governance_command_idempotency where state='committed') as dedupe,
      (select count(*)::int from public.audit_events where app='parameter-governance' and severity='info') as success,
      (select jsonb_agg(to_jsonb(s)) from parameter_catalog.catalog_state s) as catalog_state,
      (select count(*)::int from parameter_catalog.parameter_definitions) as definitions,
      (select count(*)::int from parameter_catalog.definition_revisions) as definition_revisions`)).rows[0];
  };

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("r2proposal");
    root = createPostgresDatabase(database.url);
    const pool = getRootPostgresPool(root);
    if (!pool) throw new Error("R2-PROP requires real PostgreSQL");
    const installed = await installPublishedCatalogChain(pool);
    releaseId = installed.pinC.id;
    await pool.query("insert into public.organizations (id, name) values ($1, 'R2 Proposal')", [ORG_ID]);
    await pool.query(
      `insert into public.users (id, organization_id, name, email, title, is_active)
       values ($1, $2, 'Proposal Author', 'author@r2-proposal.test', 'Author', true)`, [AUTHOR_ID, ORG_ID],
    );
    await pool.query(`insert into public.users (id, organization_id, name, email, title, is_active)
      values ('user-r2-prop-other-author', $1, 'Other Author', 'other@r2-proposal.test', 'Author', true)`, [ORG_ID]);
    await pool.query(`insert into public.user_role_bindings (id, user_id, organization_id, role_id)
      values ('urb-r2-prop-other-author', 'user-r2-prop-other-author', $1, 'admin')`, [ORG_ID]);
    await pool.query("insert into public.organizations (id, name) values ('org-r2-prop-other', 'Other organization')");
    await pool.query(`insert into public.users (id, organization_id, name, email, title, is_active)
      values ('user-r2-prop-reviewer', $1, 'Reviewer', 'reviewer@r2-proposal.test', 'Reviewer', true),
      ('user-r2-prop-other-org', 'org-r2-prop-other', 'Other org', 'other-org@r2-proposal.test', 'Admin', true)`, [ORG_ID]);
    await pool.query(`insert into public.user_role_bindings (id, user_id, organization_id, role_id)
      values ('urb-r2-prop-reviewer', 'user-r2-prop-reviewer', $1, 'platform-admin'),
      ('urb-r2-prop-other-org', 'user-r2-prop-other-org', 'org-r2-prop-other', 'admin')`, [ORG_ID]);
    await pool.query(
      `insert into public.user_role_bindings (id, user_id, organization_id, role_id)
       values ('urb-r2-prop-author', $1, $2, 'admin')`, [AUTHOR_ID, ORG_ID],
    );
    server = createWiseEffServer({
      db: root,
      auth: {
        mode: "production",
        verifier: {
          // Deterministic identity-provider fixture only; root authentication and PG role lookup stay real.
          verify: async (authorization) => {
            if (!/^Bearer r2-proposal-(author|other-author|reviewer|self-reviewer|inactive|other-org|guest)$/.test(authorization ?? "")) throw new Error("Invalid fixture bearer");
            const suppliedActor = authorization!.replace("Bearer r2-proposal-", "");
            const personId = ["other-author", "reviewer", "other-org"].includes(suppliedActor) ? `user-r2-prop-${suppliedActor}` : AUTHOR_ID;
            const organizationId = suppliedActor === "other-org" ? "org-r2-prop-other" : ORG_ID;
            return {
              user: { id: personId, organizationId, name: "Proposal Author", email: "author@r2-proposal.test", emailVerified: true, title: "Author", isActive: true },
              organization: { id: organizationId, name: "R2 Proposal" }, roles: [], permissions: [],
            };
          },
        },
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await root?.close();
    await database?.close();
  });

  afterEach(async () => { setProposalWriterTestHooks(null); await setActor("author"); });

  for (const vector of proposalContractVectors) {
    it(`${vector.id}: ${vector.name}`, async () => {
      await vector.run({ governance: createApiParameterCatalogGovernanceRepository(client()), authorId: AUTHOR_ID, releaseId, definitionId: X_DEFINITION_ID, revisionId: X_REVISION_2,
        setActor, businessEvidence: evidence,
      });
    });
  }

  it("R2-REV-02-history: stored legacy content and its original success snapshot use the same output normalization", async () => {
    const governance = createApiParameterCatalogGovernanceRepository(client());
    const body = { base: { catalogReleaseId: releaseId }, requestedChange: { kind: "", note: "Retained legacy field", nested: { enabled: true } }, reason: "historical output compatibility" };
    const write = { catalogReleaseId: releaseId, idempotencyKey: "review-historical-payload" };
    const created = await governance.createProposal(body, write);
    const pool = getRootPostgresPool(root)!;
    // The real command stores the legacy-accepted empty kind unchanged. Verify the
    // raw immutable revision and original success snapshot, without rewriting either.
    const stored = (await pool.query("select payload from parameter_catalog.definition_proposal_revisions where proposal_id=$1", [created.item.id])).rows[0].payload;
    const snapshot = (await pool.query("select metadata->'resultSnapshot'->'requestedChange' as content from public.audit_events where target_id=$1 and action='proposal-create-draft'", [created.item.id])).rows[0].content;
    expect(stored).toEqual(body.requestedChange);
    expect(snapshot).toEqual(body.requestedChange);
    const expected = { ...body.requestedChange, kind: "definition-proposal" };
    const before = await evidence();
    expect((await governance.getProposal(created.item.id)).item.requestedChange).toEqual(expected);
    expect((await governance.listProposals({ limit: 100 })).items.find((item) => item.id === created.item.id)?.requestedChange).toEqual(expected);
    expect((await governance.createProposal(body, write)).item.requestedChange).toEqual(expected);
    expect(await evidence()).toEqual(before);
    const submitted = await governance.submitProposal(created.item.id, {}, { catalogReleaseId: releaseId, idempotencyKey: "review-historical-submit", ifMatch: created.item.etag });
    expect(submitted.item.requestedChange).toEqual(expected);
    expect((await governance.getProposal(created.item.id)).item.requestedChange).toEqual(expected);
  });

  it("R2-PROP-09: create fault rolls back status, success audit and idempotency before retry", async () => {
    const pool = getRootPostgresPool(root)!;
    const counts = async () => (await pool.query(`select
      (select count(*)::int from parameter_catalog.definition_proposals) as proposals,
      (select count(*)::int from parameter_catalog.definition_proposal_revisions) as revisions,
      (select count(*)::int from parameter_catalog.catalog_publication_intents) as intents,
      (select count(*)::int from parameter_catalog.governance_command_idempotency) as dedupe,
      (select count(*)::int from public.audit_events where app='parameter-governance' and severity='info') as success`)).rows[0];
    const before = await counts();
    const governance = createApiParameterCatalogGovernanceRepository(client());
    const body = { base: { catalogReleaseId: releaseId }, requestedChange: { kind: "new-definition" }, reason: "fault" };
    const write = { catalogReleaseId: releaseId, idempotencyKey: "t09-create" };
    setProposalWriterTestHooks({ afterStatusBeforeSuccessAudit: () => { throw new Error("R2 controlled transaction fault"); } });
    await expect(governance.createProposal(body, write)).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(await counts()).toEqual(before);
    setProposalWriterTestHooks(null);
    expect((await governance.createProposal(body, write)).item.status).toBe("draft");
  });

  it("R2-PROP-09B: accept fault rolls back intent and success audit, retry produces exactly one intent and no Catalog writes", async () => {
    const governance = createApiParameterCatalogGovernanceRepository(client());
    const draft = await governance.createProposal({ base: { catalogReleaseId: releaseId }, requestedChange: { kind: "new-definition" }, reason: "accept fault" }, { catalogReleaseId: releaseId, idempotencyKey: "t09b-create" });
    const submitted = await governance.submitProposal(draft.item.id, {}, { catalogReleaseId: releaseId, idempotencyKey: "t09b-submit", ifMatch: draft.item.etag });
    await setActor("reviewer");
    const before = await evidence();
    const write = { catalogReleaseId: releaseId, idempotencyKey: "t09b-accept", ifMatch: submitted.item.etag };
    const body = { repositoryReference: "refs/heads/accept-fault" };
    setProposalWriterTestHooks({ afterStatusBeforeSuccessAudit: () => { throw new Error("R2 controlled accept fault"); } });
    await expect(governance.acceptProposal(draft.item.id, body, write)).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(await evidence()).toEqual(before);
    setProposalWriterTestHooks(null);
    const accepted = await governance.acceptProposal(draft.item.id, body, write);
    const after = await evidence();
    expect(accepted.item.status).toBe("accepted");
    expect(after.intents).toBe(before.intents + 1);
    expect(after.success).toBe(before.success + 1);
    expect(after.catalog_state).toEqual(before.catalog_state);
    expect(after.definitions).toBe(before.definitions);
    expect(after.definition_revisions).toBe(before.definition_revisions);
    expect(await governance.acceptProposal(draft.item.id, body, write)).toEqual(accepted);
    expect(await evidence()).toEqual(after);
  });

  it("R2-PROP-12: incomplete legacy success snapshot fails closed without current-state fallback", async () => {
    const governance = createApiParameterCatalogGovernanceRepository(client());
    const body = { base: { catalogReleaseId: releaseId }, requestedChange: { kind: "new-definition" }, reason: "legacy" };
    const write = { catalogReleaseId: releaseId, idempotencyKey: "t12-create" };
    const created = await governance.createProposal(body, write);
    const pool = getRootPostgresPool(root)!;
    const before = (await pool.query("select state, request_fingerprint, result_ref from parameter_catalog.governance_command_idempotency where idempotency_key = 't12-create'")).rows;
    // Disposable lane-only corruption of stored evidence, never change the request/fingerprint.
    await pool.query("update public.audit_events set metadata = metadata - 'resultSnapshot' where target_id = $1 and action = 'proposal-create-draft'", [created.item.id]);
    const response = await fetch(`${baseUrl}/api/v2/catalog/definition-proposals`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer r2-proposal-author", "Idempotency-Key": write.idempotencyKey, "X-WiseEff-Catalog-Release": releaseId }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(503);
    expect(response.headers.has("Retry-After")).toBe(false);
    expect(await response.json()).toMatchObject({ error: { code: "SERVICE_UNAVAILABLE", details: { reason: "proposal-replay-unavailable", retryable: false } } });
    expect((await pool.query("select state, request_fingerprint, result_ref from parameter_catalog.governance_command_idempotency where idempotency_key = 't12-create'")).rows).toEqual(before);
    expect((await governance.getProposal(created.item.id)).item.status).toBe("draft");
  });

  it.each([
    ["status", "published"], ["submittedByPersonId", null], ["requestedChange", null],
    ["organizationId", "wrong-org"], ["etagVersion", -1],
  ])("R2-PROP-12B: malformed snapshot %s fails closed", async (field, value) => {
    const governance = createApiParameterCatalogGovernanceRepository(client());
    const body = { base: { catalogReleaseId: releaseId }, requestedChange: { kind: "new-definition" }, reason: "partial legacy" };
    const write = { catalogReleaseId: releaseId, idempotencyKey: `t12b-${field}` };
    const created = await governance.createProposal(body, write);
    const pool = getRootPostgresPool(root)!;
    const before = await evidence();
    await pool.query("update public.audit_events set metadata=jsonb_set(metadata, ARRAY['resultSnapshot', $2], $3::jsonb) where target_id=$1 and action='proposal-create-draft'", [created.item.id, field, JSON.stringify(value)]);
    await expect(governance.createProposal(body, write)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", details: { reason: "proposal-replay-unavailable", retryable: false } });
    expect(await evidence()).toEqual(before);
  });
});
