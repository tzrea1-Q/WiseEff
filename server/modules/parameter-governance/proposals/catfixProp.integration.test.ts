import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import {
  DefinitionProposalId,
  DefinitionRevisionId,
  ParameterDefinitionId,
  type CatalogReleasePin,
} from "../../parameter-catalog-contract/index";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";

import type {
  AcceptProposalCommand,
  CreateDraftProposalCommand,
  RejectProposalCommand,
  SubmitExistingProposalCommand,
  SubmitProposalCommand,
  WithdrawProposalCommand,
} from "./command";
import { createProposalService, executeCreateAndSubmit } from "./service";
import { setProposalWriterTestHooks } from "./writer";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "CATFIX-PROP requires a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_extension where extname = 'vector'
       ) as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "CATFIX-PROP requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_ID = "org-catfix-prop";
const OTHER_ORG_ID = "org-catfix-prop-other";
const PROPOSER = "user-org-admin-proposer";
const REVIEWER = "user-platform-admin-reviewer";
const BASE_DEFINITION = ParameterDefinitionId("pdef_acme_power_iin_max");
const BASE_REVISION = DefinitionRevisionId("drev_acme_power_iin_max_1");

const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

const compileOrThrow = (bundle: CatalogReleaseBundle) => {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(
      `fixture failed to compile: ${compiled.error.kind} ${JSON.stringify(compiled.error.violations)}`,
    );
  }
  return compiled.value;
};

describe("CATFIX-PROP proposal state machine", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let pin: CatalogReleasePin;
  let service: ReturnType<typeof createProposalService>;

  const createDraftCommand = (
    overrides: Partial<CreateDraftProposalCommand> = {},
  ): CreateDraftProposalCommand => ({
    kind: "create-draft",
    organizationId: ORG_ID,
    baseRelease: pin,
    currentRelease: pin,
    claimedBaseReleaseId: pin.id,
    baseDefinitionId: BASE_DEFINITION,
    baseDefinitionRevisionId: BASE_REVISION,
    payload: { change: "raise-iin-max", note: "stable" },
    reason: "field measurement requires a higher limit",
    evidenceRefs: ["evidence:catfix-prop"],
    idempotencyKey: `draft:${randomUUID()}`,
    context: { actorKind: "org-admin", principalId: PROPOSER },
    ...overrides,
  });

  const submitExistingCommand = (
    proposalId: string,
    expectedEtag: number,
    overrides: Partial<SubmitExistingProposalCommand> = {},
  ): SubmitExistingProposalCommand => ({
    kind: "submit-existing",
    organizationId: ORG_ID,
    proposalId: DefinitionProposalId(proposalId),
    expectedEtag,
    currentRelease: pin,
    idempotencyKey: `submit-existing:${randomUUID()}`,
    context: { actorKind: "org-admin", principalId: PROPOSER },
    ...overrides,
  });

  const createAndSubmitCommand = (
    overrides: Partial<SubmitProposalCommand> = {},
  ): SubmitProposalCommand => ({
    kind: "submit",
    organizationId: ORG_ID,
    baseRelease: pin,
    currentRelease: pin,
    baseDefinitionRevisionId: BASE_REVISION,
    payload: { change: "raise-iin-max", note: "adapter" },
    reason: "internal create-and-submit adapter",
    evidenceRefs: ["evidence:adapter"],
    idempotencyKey: `submit:${randomUUID()}`,
    context: { actorKind: "org-admin", principalId: PROPOSER },
    ...overrides,
  });

  const withdrawCommand = (
    proposalId: string,
    expectedEtag: number,
    overrides: Partial<WithdrawProposalCommand> = {},
  ): WithdrawProposalCommand => ({
    kind: "withdraw",
    organizationId: ORG_ID,
    proposalId: DefinitionProposalId(proposalId),
    expectedEtag,
    idempotencyKey: `withdraw:${randomUUID()}`,
    context: { actorKind: "org-admin", principalId: PROPOSER },
    ...overrides,
  });

  const acceptCommand = (
    proposalId: string,
    expectedEtag: number,
    overrides: Partial<AcceptProposalCommand> = {},
  ): AcceptProposalCommand => ({
    kind: "accept",
    organizationId: ORG_ID,
    proposalId: DefinitionProposalId(proposalId),
    expectedEtag,
    currentRelease: pin,
    repositoryReference: "repo://wiseeff-catalog/schemas/dts/vendor/acme-power.yaml",
    idempotencyKey: `accept:${randomUUID()}`,
    context: { actorKind: "platform-admin", principalId: REVIEWER },
    ...overrides,
  });

  const rejectCommand = (
    proposalId: string,
    expectedEtag: number,
    overrides: Partial<RejectProposalCommand> = {},
  ): RejectProposalCommand => ({
    kind: "reject",
    organizationId: ORG_ID,
    proposalId: DefinitionProposalId(proposalId),
    expectedEtag,
    currentRelease: pin,
    reason: "out of publication scope",
    idempotencyKey: `reject:${randomUUID()}`,
    context: { actorKind: "platform-admin", principalId: REVIEWER },
    ...overrides,
  });

  const residue = async () => {
    const result = await pool.query<{
      proposals: string;
      revisions: string;
      intents: string;
      idempotency: string;
    }>(`
      select
        (select count(*)::text from parameter_catalog.definition_proposals) as proposals,
        (select count(*)::text from parameter_catalog.definition_proposal_revisions) as revisions,
        (select count(*)::text from parameter_catalog.catalog_publication_intents) as intents,
        (select count(*)::text from parameter_catalog.governance_command_idempotency) as idempotency
    `);
    return result.rows[0]!;
  };

  const catalogFootprint = async () => {
    const result = await pool.query<{
      releases: string;
      subjects: string;
      revisions: string;
      current_release: string | null;
    }>(`
      select
        (select count(*)::text from parameter_catalog.catalog_releases) as releases,
        (select count(*)::text from parameter_catalog.catalog_subjects) as subjects,
        (select count(*)::text from parameter_catalog.definition_revisions) as revisions,
        (select current_catalog_release_id from parameter_catalog.catalog_state) as current_release
    `);
    return result.rows[0]!;
  };

  const proposalRow = async (proposalId: string) => {
    const result = await pool.query<{
      id: string;
      status: string;
      etag_version: string;
      base_catalog_release_id: string;
      base_definition_revision_id: string | null;
      current_proposal_revision_id: string;
    }>(
      `select id, status, etag_version::text as etag_version, base_catalog_release_id,
              base_definition_revision_id, current_proposal_revision_id
         from parameter_catalog.definition_proposals
        where id = $1`,
      [proposalId],
    );
    return result.rows[0] ?? null;
  };

  const successAuditCount = async (targetId: string) => {
    const result = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from public.audit_events
        where organization_id = $1
          and kind = 'definition-proposal'
          and severity = 'info'
          and target_id = $2`,
      [ORG_ID, targetId],
    );
    return Number(result.rows[0]?.count ?? 0);
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("catfixp");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const first = compileOrThrow(firstReleaseBundle());
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    pin = { id: first.release.id, digest: first.release.digest };
    await pool.query(`insert into public.organizations (id, name) values ($1, 'CATFIX PROP'), ($2, 'OTHER')`, [
      ORG_ID,
      OTHER_ORG_ID,
    ]);
    service = createProposalService(pool);
  }, 60_000);

  afterEach(() => {
    setProposalWriterTestHooks(null);
  });

  afterAll(async () => {
    setProposalWriterTestHooks(null);
    await pool?.end();
    await database?.drop();
  });

  it("CATFIX-PROP-01: create-draft stores one draft with real base, content, and a stable id", async () => {
    const result = await service.execute(createDraftCommand());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("committed");
    expect(result.value.status).toBe("draft");
    expect(result.value.proposalId).toMatch(/^dprop_/);
    expect(result.value.revisionNumber).toBe(1);
    expect(result.value.etagVersion).toBe(1);
    expect(result.value.baseCatalogReleaseId).toBe(pin.id);
    expect(result.value.baseDefinitionRevisionId).toBe(BASE_REVISION);
    expect(result.value.publicationIntent).toBeNull();

    const stored = await proposalRow(result.value.proposalId);
    expect(stored).toMatchObject({
      id: result.value.proposalId,
      status: "draft",
      etag_version: "1",
      base_catalog_release_id: pin.id,
      base_definition_revision_id: BASE_REVISION,
      current_proposal_revision_id: result.value.proposalRevisionId,
    });
    const payload = await pool.query<{ payload: { change: string } }>(
      `select payload from parameter_catalog.definition_proposal_revisions where id = $1`,
      [result.value.proposalRevisionId],
    );
    expect(payload.rows[0]?.payload).toMatchObject({ change: "raise-iin-max" });
    expect(
      await pool.query(
        `select 1 from parameter_catalog.catalog_publication_intents where proposal_id = $1`,
        [result.value.proposalId],
      ),
    ).toMatchObject({ rowCount: 0 });
  });

  it("CATFIX-PROP-02: submit-existing transitions the same proposalId to submitted without a new Proposal", async () => {
    const created = await service.execute(createDraftCommand());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = await residue();
    const submitted = await service.execute(
      submitExistingCommand(created.value.proposalId, created.value.etagVersion),
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.value.proposalId).toBe(created.value.proposalId);
    expect(submitted.value.proposalRevisionId).toBe(created.value.proposalRevisionId);
    expect(submitted.value.status).toBe("submitted");
    expect(submitted.value.etagVersion).toBeGreaterThan(created.value.etagVersion);
    expect(submitted.value.baseCatalogReleaseId).toBe(created.value.baseCatalogReleaseId);
    expect(submitted.value.baseDefinitionRevisionId).toBe(created.value.baseDefinitionRevisionId);
    const after = await residue();
    expect(after.proposals).toBe(before.proposals);
    expect(after.revisions).toBe(before.revisions);
    expect(after.intents).toBe(before.intents);
  });

  it("CATFIX-PROP-03: a wrong ETag conflicts and leaves status, revision, intent, and success audit unchanged", async () => {
    const created = await service.execute(createDraftCommand());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = await residue();
    const auditsBefore = await successAuditCount(created.value.proposalId);
    const conflicted = await service.execute(
      submitExistingCommand(created.value.proposalId, created.value.etagVersion + 7),
    );
    expect(conflicted.ok).toBe(false);
    if (conflicted.ok) return;
    expect(conflicted.error.kind).toBe("revision-conflict");
    expect(await residue()).toEqual(before);
    expect(await successAuditCount(created.value.proposalId)).toBe(auditsBefore);
    expect(await proposalRow(created.value.proposalId)).toMatchObject({
      status: "draft",
      etag_version: String(created.value.etagVersion),
      current_proposal_revision_id: created.value.proposalRevisionId,
    });
  });

  it("CATFIX-PROP-04: identical replay returns the original snapshot without new side effects", async () => {
    const command = createDraftCommand({ idempotencyKey: `replay:${randomUUID()}` });
    const first = await service.execute(command);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const submitted = await service.execute(
      submitExistingCommand(first.value.proposalId, first.value.etagVersion),
    );
    expect(submitted.ok).toBe(true);
    const before = await residue();
    const auditsBefore = await successAuditCount(first.value.proposalId);
    const replayed = await service.execute(command);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.value).toEqual({ ...first.value, outcome: "replayed" });
    expect(replayed.value.status).toBe("draft");
    expect(replayed.value.etagVersion).toBe(first.value.etagVersion);
    expect(await residue()).toEqual(before);
    expect(await successAuditCount(first.value.proposalId)).toBe(auditsBefore);
    expect((await proposalRow(first.value.proposalId))?.status).toBe("submitted");
  });

  it("CATFIX-PROP-05: the same key with different payload or command is conflicted or scoped apart", async () => {
    const key = `scope:${randomUUID()}`;
    const first = await service.execute(createDraftCommand({ idempotencyKey: key }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const tampered = await service.execute(
      createDraftCommand({
        idempotencyKey: key,
        payload: { change: "raise-iin-max", note: "tampered" },
      }),
    );
    expect(tampered.ok).toBe(false);
    if (tampered.ok) return;
    expect(tampered.error.kind).toBe("revision-conflict");

    const isolated = await service.execute(
      submitExistingCommand(first.value.proposalId, first.value.etagVersion, {
        idempotencyKey: key,
      }),
    );
    expect(isolated.ok).toBe(true);
    if (!isolated.ok) return;
    expect(isolated.value.proposalId).toBe(first.value.proposalId);
    expect(isolated.value.status).toBe("submitted");
  });

  it("CATFIX-PROP-06: a lost submit-existing response retries the same proposalId and key past the new ETag", async () => {
    const created = await service.execute(createDraftCommand());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const command = submitExistingCommand(created.value.proposalId, created.value.etagVersion, {
      idempotencyKey: `lost:${randomUUID()}`,
    });
    const first = await service.execute(command);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.etagVersion).toBeGreaterThan(command.expectedEtag);
    const before = await residue();
    const retry = await service.execute(command);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value).toEqual({ ...first.value, outcome: "replayed" });
    expect(retry.value.proposalId).toBe(created.value.proposalId);
    expect(await residue()).toEqual(before);
  });

  it("CATFIX-PROP-07: concurrent accept and reject with the same ETag commit only one result", async () => {
    const created = await service.execute(createDraftCommand());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const submitted = await service.execute(
      submitExistingCommand(created.value.proposalId, created.value.etagVersion),
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const catalogBefore = await catalogFootprint();
    const [left, right] = await Promise.all([
      service.execute(acceptCommand(submitted.value.proposalId, submitted.value.etagVersion)),
      service.execute(rejectCommand(submitted.value.proposalId, submitted.value.etagVersion)),
    ]);
    const outcomes = [left, right];
    const committed = outcomes.filter((result) => result.ok);
    const conflicted = outcomes.filter((result) => !result.ok);
    expect(committed).toHaveLength(1);
    expect(conflicted).toHaveLength(1);
    if (!conflicted[0] || conflicted[0].ok) return;
    expect(conflicted[0].error.kind).toBe("revision-conflict");
    if (!committed[0] || !committed[0].ok) return;
    expect(["accepted", "rejected"]).toContain(committed[0].value.status);
    const stored = await proposalRow(submitted.value.proposalId);
    expect(stored?.status).toBe(committed[0].value.status);
    const intents = await pool.query(
      `select 1 from parameter_catalog.catalog_publication_intents where proposal_id = $1`,
      [submitted.value.proposalId],
    );
    expect(intents.rowCount).toBe(committed[0].value.status === "accepted" ? 1 : 0);
    expect(await catalogFootprint()).toEqual(catalogBefore);
  });

  it("CATFIX-PROP-08: the author cannot accept or reject their own proposal", async () => {
    const created = await service.execute(createDraftCommand());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const submitted = await service.execute(
      submitExistingCommand(created.value.proposalId, created.value.etagVersion),
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const before = await residue();
    const selfAccept = await service.execute(
      acceptCommand(submitted.value.proposalId, submitted.value.etagVersion, {
        context: { actorKind: "platform-admin", principalId: PROPOSER },
      }),
    );
    expect(selfAccept.ok).toBe(false);
    if (selfAccept.ok) return;
    expect(selfAccept.error.kind).toBe("proposal-self-approval-forbidden");
    const selfReject = await service.execute(
      rejectCommand(submitted.value.proposalId, submitted.value.etagVersion, {
        context: { actorKind: "platform-admin", principalId: PROPOSER },
      }),
    );
    expect(selfReject.ok).toBe(false);
    if (selfReject.ok) return;
    expect(selfReject.error.kind).toBe("proposal-self-approval-forbidden");
    expect(await residue()).toEqual(before);
    expect((await proposalRow(submitted.value.proposalId))?.status).toBe("submitted");
  });

  it("CATFIX-PROP-09: a stale base release is proposal-stale and is not replaced with the latest pin", async () => {
    const created = await service.execute(createDraftCommand());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const capturedPin = pin;
    const successor = compileOrThrow(validCatalogReleaseBundle());
    const advanced = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(validCatalogReleaseBundle()),
      expectedCurrent: pin,
      expectedTargetDigest: successor.aggregateDigest,
    });
    expect(advanced.ok).toBe(true);
    const nextPin = { id: successor.release.id, digest: successor.release.digest };
    pin = nextPin;

    const staleWithOldCurrent = await service.execute(
      submitExistingCommand(created.value.proposalId, created.value.etagVersion, {
        currentRelease: capturedPin,
      }),
    );
    expect(staleWithOldCurrent.ok).toBe(false);
    if (staleWithOldCurrent.ok) return;
    expect(staleWithOldCurrent.error.kind).toBe("proposal-stale");

    const staleWithLatestCurrent = await service.execute(
      submitExistingCommand(created.value.proposalId, created.value.etagVersion, {
        currentRelease: nextPin,
      }),
    );
    expect(staleWithLatestCurrent.ok).toBe(false);
    if (staleWithLatestCurrent.ok) return;
    expect(staleWithLatestCurrent.error.kind).toBe("proposal-stale");
    if (staleWithLatestCurrent.error.kind === "proposal-stale") {
      expect(staleWithLatestCurrent.error.capturedRelease.id).toBe(capturedPin.id);
      expect(staleWithLatestCurrent.error.currentRelease.id).toBe(nextPin.id);
    }

    const staleCreate = await service.execute(
      createDraftCommand({
        baseRelease: capturedPin,
        currentRelease: capturedPin,
        claimedBaseReleaseId: capturedPin.id,
      }),
    );
    expect(staleCreate.ok).toBe(false);
    if (staleCreate.ok) return;
    expect(staleCreate.error.kind).toBe("proposal-stale");

    expect((await proposalRow(created.value.proposalId))?.status).toBe("draft");
    expect((await proposalRow(created.value.proposalId))?.base_catalog_release_id).toBe(
      capturedPin.id,
    );
  });

  it("CATFIX-PROP-10: accept writes exactly one Publication Intent and does not write official Catalog rows", async () => {
    const created = await service.execute(createDraftCommand());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const submitted = await service.execute(
      submitExistingCommand(created.value.proposalId, created.value.etagVersion),
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const catalogBefore = await catalogFootprint();
    const accepted = await service.execute(
      acceptCommand(submitted.value.proposalId, submitted.value.etagVersion),
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.status).toBe("accepted");
    expect(accepted.value.publicationIntent?.id).toMatch(/^cpint_/);
    const intents = await pool.query(
      `select 1 from parameter_catalog.catalog_publication_intents where proposal_id = $1`,
      [submitted.value.proposalId],
    );
    expect(intents.rowCount).toBe(1);
    expect(await catalogFootprint()).toEqual(catalogBefore);
  });

  it("CATFIX-PROP-11: a fault after the status write and before success audit rolls back with no half-state", async () => {
    const created = await service.execute(createDraftCommand());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = await residue();
    const auditsBefore = await successAuditCount(created.value.proposalId);
    setProposalWriterTestHooks({
      afterStatusBeforeSuccessAudit: () => {
        throw new Error("injected after status before audit");
      },
    });
    await expect(
      service.execute(submitExistingCommand(created.value.proposalId, created.value.etagVersion)),
    ).rejects.toThrow(/injected after status before audit/);
    setProposalWriterTestHooks(null);
    expect(await residue()).toEqual(before);
    expect(await successAuditCount(created.value.proposalId)).toBe(auditsBefore);
    expect((await proposalRow(created.value.proposalId))?.status).toBe("draft");
  });

  it("CATFIX-PROP-12: cross-org submit and a demoted replay are refused; idempotency is not an authz bypass", async () => {
    const command = createDraftCommand({ idempotencyKey: `authz:${randomUUID()}` });
    const created = await service.execute(command);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = await residue();
    const crossOrg = await service.execute(
      submitExistingCommand(created.value.proposalId, created.value.etagVersion, {
        organizationId: OTHER_ORG_ID,
      }),
    );
    expect(crossOrg.ok).toBe(false);
    if (crossOrg.ok) return;
    expect(crossOrg.error.kind).toBe("proposal-not-found");

    const demoted = await service.execute({
      ...command,
      context: { actorKind: "platform-admin", principalId: PROPOSER },
    });
    expect(demoted.ok).toBe(false);
    if (demoted.ok) return;
    expect(demoted.error.kind).toBe("permission-denied");
    expect((await proposalRow(created.value.proposalId))?.status).toBe("draft");
    expect(Number((await residue()).proposals)).toBe(Number(before.proposals));
  });

  it("CATFIX-PROP-13: swapping proposalId and definitionRevisionId fails type shape and referential checks", async () => {
    const created = await service.execute(createDraftCommand());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const swappedSubmit = await service.execute(
      submitExistingCommand(BASE_REVISION, created.value.etagVersion),
    );
    expect(swappedSubmit.ok).toBe(false);
    if (swappedSubmit.ok) return;
    expect(swappedSubmit.error.kind).toBe("proposal-not-found");

    const swappedCreate = await service.execute(
      createDraftCommand({
        baseDefinitionRevisionId: DefinitionRevisionId(created.value.proposalId),
      }),
    );
    expect(swappedCreate.ok).toBe(false);
    if (swappedCreate.ok) return;
    expect(swappedCreate.error.kind).toBe("invalid-command");
    expect((await proposalRow(created.value.proposalId))?.status).toBe("draft");
  });

  it("CATFIX-PROP-14: kind:submit remains the internal create-and-submit adapter and does not back submit-existing", async () => {
    const draft = await service.execute(createDraftCommand());
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const beforeAdapter = await residue();
    const submittedExisting = await service.execute(
      submitExistingCommand(draft.value.proposalId, draft.value.etagVersion),
    );
    expect(submittedExisting.ok).toBe(true);
    if (!submittedExisting.ok) return;
    expect(submittedExisting.value.proposalId).toBe(draft.value.proposalId);
    expect(await residue()).toMatchObject({
      proposals: beforeAdapter.proposals,
      revisions: beforeAdapter.revisions,
    });

    const adapted = await executeCreateAndSubmit(pool, createAndSubmitCommand());
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.value.status).toBe("submitted");
    expect(adapted.value.proposalId).not.toBe(draft.value.proposalId);
    expect(adapted.value.etagVersion).toBe(1);
    const afterAdapter = await residue();
    expect(Number(afterAdapter.proposals)).toBe(Number(beforeAdapter.proposals) + 1);
    expect(Number(afterAdapter.revisions)).toBe(Number(beforeAdapter.revisions) + 1);

    const resubmitOld = await service.execute(
      submitExistingCommand(adapted.value.proposalId, adapted.value.etagVersion),
    );
    expect(resubmitOld.ok).toBe(false);
    if (resubmitOld.ok) return;
    expect(resubmitOld.error).toMatchObject({
      kind: "invalid-transition",
      from: "submitted",
      attempted: "submitted",
    });
    expect((await proposalRow(adapted.value.proposalId))?.id).toBe(adapted.value.proposalId);
  });

  it("CATFIX-PROP-15: a new-definition draft keeps a null base revision and does not invent an id", async () => {
    const result = await service.execute(
      createDraftCommand({
        baseDefinitionId: null,
        baseDefinitionRevisionId: null,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("draft");
    expect(result.value.baseDefinitionRevisionId).toBeNull();
    expect(result.value.baseCatalogReleaseId).toBe(pin.id);
    const stored = await proposalRow(result.value.proposalId);
    expect(stored?.base_definition_revision_id).toBeNull();
    expect(stored?.status).toBe("draft");
  });
});

describe("CATFIX-PROP coverage ratchet", () => {
  it("names CATFIX-PROP-01 through CATFIX-PROP-15 in this suite", () => {
    const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
    for (let index = 1; index <= 15; index += 1) {
      const id = `CATFIX-PROP-${String(index).padStart(2, "0")}`;
      expect(source, id).toContain(id);
    }
  });
});
