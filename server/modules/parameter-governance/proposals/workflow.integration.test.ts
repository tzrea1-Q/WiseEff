import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import {
  DefinitionProposalId,
  DefinitionRevisionId,
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
  SubmitProposalCommand,
  WithdrawProposalCommand,
} from "./command";
import { createProposalService } from "./service";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S5-PRP requires a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S5-PRP requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_ID = "org-s5-prp";
const PROPOSER = "user-org-admin-proposer";
const REVIEWER = "user-platform-admin-reviewer";
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

describe("immutable DefinitionProposal workflow", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let pin: CatalogReleasePin;
  let service: ReturnType<typeof createProposalService>;

  const submitCommand = (
    overrides: Partial<SubmitProposalCommand> = {},
  ): SubmitProposalCommand => ({
    kind: "submit",
    organizationId: ORG_ID,
    baseRelease: pin,
    currentRelease: pin,
    baseDefinitionRevisionId: BASE_REVISION,
    payload: { change: "raise-iin-max", note: "stable" },
    reason: "field measurement requires a higher limit",
    evidenceRefs: ["evidence:s5-prp"],
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

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("s5prp");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const first = compileOrThrow(firstReleaseBundle());
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    pin = { id: first.release.id, digest: first.release.digest };
    await pool.query(`insert into public.organizations (id, name) values ($1, 'S5 PRP')`, [ORG_ID]);
    service = createProposalService(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("submits a captured base revision as immutable proposal revision 1", async () => {
    const result = await service.execute(submitCommand());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("committed");
    expect(result.value.status).toBe("submitted");
    expect(result.value.revisionNumber).toBe(1);
    expect(result.value.etagVersion).toBe(1);
    expect(result.value.baseCatalogReleaseId).toBe(pin.id);
    expect(result.value.baseDefinitionRevisionId).toBe(BASE_REVISION);
    expect(result.value.publicationIntent).toBeNull();
    expect(result.value.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);

    const stored = await pool.query<{
      status: string;
      revision_number: string;
      revision_id: string;
    }>(
      `
      select proposal.status,
             revision.revision_number::text,
             revision.id as revision_id
        from parameter_catalog.definition_proposals proposal
        join parameter_catalog.definition_proposal_revisions revision
          on revision.proposal_id = proposal.id
         and revision.id = proposal.current_proposal_revision_id
       where proposal.id = $1
      `,
      [result.value.proposalId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toEqual({
      status: "submitted",
      revision_number: "1",
      revision_id: result.value.proposalRevisionId,
    });
    expect(
      await pool.query(
        `select 1 from parameter_catalog.catalog_publication_intents where proposal_id = $1`,
        [result.value.proposalId],
      ),
    ).toMatchObject({ rowCount: 0 });
  });

  it("refuses withdraw by a reviewer and allows the proposer to withdraw", async () => {
    const submitted = await service.execute(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const before = await residue();
    const reviewer = await service.execute(
      withdrawCommand(submitted.value.proposalId, submitted.value.etagVersion, {
        context: { actorKind: "platform-admin", principalId: REVIEWER },
      }),
    );
    expect(reviewer.ok).toBe(false);
    if (reviewer.ok) return;
    expect(reviewer.error.kind).toBe("permission-denied");
    expect(await residue()).toEqual(before);

    const statusAfterReviewer = await pool.query<{ status: string }>(
      `select status from parameter_catalog.definition_proposals where id = $1`,
      [submitted.value.proposalId],
    );
    expect(statusAfterReviewer.rows[0]?.status).toBe("submitted");

    const withdrawn = await service.execute(
      withdrawCommand(submitted.value.proposalId, submitted.value.etagVersion),
    );
    expect(withdrawn.ok).toBe(true);
    if (!withdrawn.ok) return;
    expect(withdrawn.value.status).toBe("withdrawn");
    expect(withdrawn.value.revisionNumber).toBe(1);
    expect(withdrawn.value.etagVersion).toBeGreaterThan(submitted.value.etagVersion);
    expect(withdrawn.value.publicationIntent).toBeNull();
    const stored = await pool.query<{ status: string; revision_count: string }>(
      `
      select status,
             (select count(*)::text
                from parameter_catalog.definition_proposal_revisions
               where proposal_id = $1) as revision_count
        from parameter_catalog.definition_proposals
       where id = $1
      `,
      [submitted.value.proposalId],
    );
    expect(stored.rows[0]).toEqual({ status: "withdrawn", revision_count: "1" });
  });

  it("replays the same submit fingerprint to the exact revision without a duplicate", async () => {
    const command = submitCommand({ idempotencyKey: `lost:${randomUUID()}` });
    const first = await service.execute(command);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await service.execute(command);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value).toEqual({
      ...first.value,
      outcome: "replayed",
    });
    const counts = await pool.query<{ proposals: string; revisions: string }>(
      `
      select
        (select count(*)::text
           from parameter_catalog.definition_proposals
          where id = $1) as proposals,
        (select count(*)::text
           from parameter_catalog.definition_proposal_revisions
          where proposal_id = $1) as revisions
      `,
      [first.value.proposalId],
    );
    expect(counts.rows[0]).toEqual({ proposals: "1", revisions: "1" });
  });

  it("conflicts when the same idempotency key is reused with a different fingerprint", async () => {
    const key = `conflict:${randomUUID()}`;
    const first = await service.execute(submitCommand({ idempotencyKey: key }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await service.execute(
      submitCommand({
        idempotencyKey: key,
        payload: { change: "raise-iin-max", note: "tampered" },
      }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe("revision-conflict");
    if (second.error.kind === "revision-conflict") {
      expect(second.error.storedFingerprint).toBe(first.value.fingerprint);
      expect(second.error.attemptedFingerprint).not.toBe(first.value.fingerprint);
    }
    const revisions = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from parameter_catalog.definition_proposal_revisions
        where proposal_id = $1`,
      [first.value.proposalId],
    );
    expect(revisions.rows[0]?.count).toBe("1");
  });

  it("refuses self-accept and records intent-only publication for a distinct reviewer", async () => {
    const submitted = await service.execute(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const before = await residue();
    const catalogBefore = await catalogFootprint();

    const selfAccept = await service.execute(
      acceptCommand(submitted.value.proposalId, submitted.value.etagVersion, {
        context: { actorKind: "platform-admin", principalId: PROPOSER },
      }),
    );
    expect(selfAccept.ok).toBe(false);
    if (selfAccept.ok) return;
    expect(selfAccept.error).toMatchObject({
      kind: "proposal-self-approval-forbidden",
      authorPrincipalId: PROPOSER,
      reviewerPrincipalId: PROPOSER,
    });
    expect(await residue()).toEqual(before);
    const refusalAudit = await pool.query<{ count: string }>(
      `
      select count(*)::text as count
        from public.audit_events
       where organization_id = $1
         and kind = 'definition-proposal'
         and action = 'proposal-accept-refused'
         and metadata->>'failureKind' = 'proposal-self-approval-forbidden'
      `,
      [ORG_ID],
    );
    expect(Number(refusalAudit.rows[0]?.count ?? 0)).toBeGreaterThan(0);

    const accepted = await service.execute(
      acceptCommand(submitted.value.proposalId, submitted.value.etagVersion),
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.status).toBe("accepted");
    expect(accepted.value.revisionNumber).toBe(1);
    expect(accepted.value.publicationIntent).toEqual({
      id: accepted.value.publicationIntent?.id,
      repositoryReference: "repo://wiseeff-catalog/schemas/dts/vendor/acme-power.yaml",
      reviewerPrincipalId: REVIEWER,
      successAuditRef: accepted.value.publicationIntent?.successAuditRef,
    });
    expect(accepted.value.publicationIntent?.id).toMatch(/^cpint_/);
    expect(accepted.value.publicationIntent?.successAuditRef).toMatch(/^audit_/);

    const intent = await pool.query<{
      proposal_id: string;
      proposal_revision_id: string;
      reviewer_principal_id: string;
      repository_reference: string;
    }>(
      `
      select proposal_id, proposal_revision_id, reviewer_principal_id, repository_reference
        from parameter_catalog.catalog_publication_intents
       where proposal_id = $1
      `,
      [submitted.value.proposalId],
    );
    expect(intent.rows).toHaveLength(1);
    expect(intent.rows[0]).toEqual({
      proposal_id: submitted.value.proposalId,
      proposal_revision_id: submitted.value.proposalRevisionId,
      reviewer_principal_id: REVIEWER,
      repository_reference: "repo://wiseeff-catalog/schemas/dts/vendor/acme-power.yaml",
    });

    const successAudit = await pool.query<{ action: string; severity: string }>(
      `
      select action, severity
        from public.audit_events
       where id = $1
      `,
      [accepted.value.publicationIntent?.successAuditRef],
    );
    expect(successAudit.rows[0]).toEqual({
      action: "proposal-accept",
      severity: "info",
    });

    expect(await catalogFootprint()).toEqual(catalogBefore);
    expect(
      await pool.query(
        `select 1 from parameter_catalog.catalog_publication_intents where proposal_id = $1`,
        [submitted.value.proposalId],
      ),
    ).toMatchObject({ rowCount: 1 });
  });

  it("refuses a stale captured base on submit and accept without writing Catalog rows", async () => {
    const pending = await service.execute(submitCommand());
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    const catalogBeforeAdvance = await catalogFootprint();
    const residueBeforeAdvance = await residue();
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

    const staleAccept = await service.execute(
      acceptCommand(pending.value.proposalId, pending.value.etagVersion, {
        currentRelease: nextPin,
      }),
    );
    expect(staleAccept.ok).toBe(false);
    if (staleAccept.ok) return;
    expect(staleAccept.error.kind).toBe("proposal-stale");

    const staleSubmit = await service.execute(
      submitCommand({
        baseRelease: capturedPin,
        currentRelease: nextPin,
      }),
    );
    expect(staleSubmit.ok).toBe(false);
    if (staleSubmit.ok) return;
    expect(staleSubmit.error.kind).toBe("proposal-stale");

    const leftover = await residue();
    expect(leftover.proposals).toBe(residueBeforeAdvance.proposals);
    expect(leftover.revisions).toBe(residueBeforeAdvance.revisions);
    expect(leftover.intents).toBe(residueBeforeAdvance.intents);

    const pendingStatus = await pool.query<{ status: string }>(
      `select status from parameter_catalog.definition_proposals where id = $1`,
      [pending.value.proposalId],
    );
    expect(pendingStatus.rows[0]?.status).toBe("submitted");

    const staleAudit = await pool.query<{ count: string }>(
      `
      select count(*)::text as count
        from public.audit_events
       where organization_id = $1
         and kind = 'definition-proposal'
         and action in ('proposal-submit-refused', 'proposal-accept-refused')
         and metadata->>'failureKind' = 'proposal-stale'
      `,
      [ORG_ID],
    );
    expect(Number(staleAudit.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(2);

    const catalogAfter = await catalogFootprint();
    expect(catalogAfter.current_release).toBe(nextPin.id);
    expect(Number(catalogAfter.releases)).toBeGreaterThan(Number(catalogBeforeAdvance.releases));
  });
});
