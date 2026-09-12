import pg from "pg";

import {
  AUTHOR,
  PUBLISHER,
  REVIEWER,
  asCoordinator,
  enablePublicationPolicy,
  lowFacts,
  publisherPermissions,
  reviewerPermissions,
  userActor,
} from "../../catalog-publication/authorization/testHarness";
import { authorizePublish } from "../../catalog-publication/authorization/authorize";
import type { ImpactFacts } from "../../catalog-publication/authorization/types";
import { buildCompleteSuccessor } from "../../catalog-publication/builder/completeSuccessor";
import {
  allocationFor,
  firstAcmePredecessor,
  frozenPageIdentity,
  pageIntegerChange,
} from "../../catalog-publication/builder/predecessorHarness";
import {
  asQueryable,
  sha256Digest,
  uniqueToken,
} from "../../catalog-publication/persistence/integrationHarness";
import {
  createJob,
  persistArtifact,
  persistCandidate,
} from "../../catalog-publication/persistence/store";
import {
  CatalogArtifactId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  PublicationJobId,
  PublicationPolicyRevision,
} from "../../parameter-catalog-contract/index";
import { createDatabase } from "../../../shared/database/client";
import { compileCatalogRelease } from "../compiler/index";
import { jsonCatalogReleaseSource } from "../interface";
import type { InstallPublishedReleaseCommand } from "../interface";
import { installPublishedRelease } from "./installer";

export { AUTHOR, PUBLISHER, REVIEWER, lowFacts, userActor, publisherPermissions, reviewerPermissions };

export type DomainSnapshot = {
  readonly current: string | null;
  readonly currentDigest: string | null;
  readonly releases: string;
  readonly materializations: string;
  readonly revisions: string;
  readonly heads: string;
  readonly receipts: string;
  readonly receiptKinds: readonly string[];
  readonly jobStatuses: readonly string[];
};

export async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

export async function domainSnapshot(client: pg.Client): Promise<DomainSnapshot> {
  const result = await client.query<{
    current: string | null;
    current_digest: string | null;
    releases: string;
    materializations: string;
    revisions: string;
    heads: string;
    receipts: string;
  }>(`
    select
      (select current_catalog_release_id from parameter_catalog.catalog_state) as current,
      (
        select release.release_digest
        from parameter_catalog.catalog_state state
        join parameter_catalog.catalog_releases release
          on release.id = state.current_catalog_release_id
      ) as current_digest,
      (select count(*)::text from parameter_catalog.catalog_releases) as releases,
      (select count(*)::text from parameter_catalog.catalog_materializations) as materializations,
      (select count(*)::text from parameter_catalog.definition_revisions) as revisions,
      (select count(*)::text from parameter_catalog.catalog_release_definition_heads) as heads,
      (select count(*)::text from parameter_catalog.catalog_activation_receipts) as receipts
  `);
  const kinds = await client.query<{ kind: string }>(
    `select kind from parameter_catalog.catalog_activation_receipts order by created_at, id`,
  );
  const jobs = await client.query<{ status: string }>(
    `select status from catalog_publication.publication_jobs order by created_at, id`,
  );
  const row = result.rows[0]!;
  return {
    current: row.current,
    currentDigest: row.current_digest,
    releases: row.releases,
    materializations: row.materializations,
    revisions: row.revisions,
    heads: row.heads,
    receipts: row.receipts,
    receiptKinds: kinds.rows.map((item) => item.kind),
    jobStatuses: jobs.rows.map((item) => item.status),
  };
}

export async function bootstrapFirstAcme(pool: pg.Pool) {
  const predecessor = firstAcmePredecessor();
  const installed = await installPublishedRelease(pool, {
    mode: "bootstrap",
    source: jsonCatalogReleaseSource(predecessor.bundle),
    expectedTargetDigest: predecessor.compiled.aggregateDigest,
  });
  if (!installed.ok || installed.value.status !== "installed") {
    throw new Error(`bootstrap failed: ${JSON.stringify(installed)}`);
  }
  return predecessor;
}

export async function persistPredecessorArtifact(
  client: pg.Client,
  predecessor: ReturnType<typeof firstAcmePredecessor>,
  token = uniqueToken("pred"),
) {
  const stored = await persistArtifact(asQueryable(client), {
    id: CatalogArtifactId(`cart_${token}`),
    artifactDigest: predecessor.digest,
    artifactBytes: predecessor.bytes,
    sourceKind: "repository-bundle",
    targetReleaseId: CatalogReleaseId(predecessor.compiled.release.id),
    targetReleaseDigest: CatalogReleaseDigest(predecessor.digest),
    predecessorReleaseId: null,
    predecessorReleaseDigest: null,
    toolchain: { ...predecessor.first.manifest.toolchain },
  });
  if (!stored.ok) {
    throw new Error(`persist predecessor failed: ${JSON.stringify(stored.error)}`);
  }
  return stored.value;
}

export async function buildAuthorizedJob(
  client: pg.Client,
  input: {
    predecessorDigest: string;
    propertyKey: string;
    authorPrincipalId?: string;
    publisherUserId?: string;
    impactFacts?: ImpactFacts;
    requestScope?: string;
    enablePolicy?: boolean;
    releaseVersion?: string;
  },
) {
  const authorPrincipalId = input.authorPrincipalId ?? PUBLISHER;
  const publisherUserId = input.publisherUserId ?? PUBLISHER;
  const token = uniqueToken(input.propertyKey);
  const policyRevision =
    input.enablePolicy === false
      ? PublicationPolicyRevision(
          Number(
            (
              await client.query<{ revision: string }>(
                `select revision::text as revision from catalog_publication.publication_policies where singleton`,
              )
            ).rows[0]!.revision,
          ),
        )
      : await enablePublicationPolicy(client, {
          publicationEnabled: true,
          lowRiskSingleActorPublish: true,
        });
  const frozen = frozenPageIdentity(
    [allocationFor(input.propertyKey)],
    token,
    input.releaseVersion ?? "1.1.0",
  );
  const built = await buildCompleteSuccessor({
    predecessorArtifact: { digest: input.predecessorDigest },
    changeSet: [pageIntegerChange(input.propertyKey, `Input ${input.propertyKey}`)],
    frozenIdentity: frozen,
    persist: {
      db: createDatabase(asQueryable(client)),
      ports: {
        persistCandidate: async (db, candidateInput) =>
          persistCandidate(db, {
            ...candidateInput,
            identityAllocation: {
              ...candidateInput.identityAllocation,
              authorPrincipalId,
            },
          }),
      },
    },
  });
  if (!built.ok || built.value.kind !== "successor" || built.value.persistence.kind !== "persisted") {
    throw new Error(`buildCompleteSuccessor failed: ${JSON.stringify(built)}`);
  }
  const candidate = built.value.persistence.candidate;
  const facts = input.impactFacts ?? lowFacts(authorPrincipalId);
  const authorized = await asCoordinator(client, async () => {
    const capability = await client.query<{ digest: string }>(
      `select catalog_publication.digest_jsonb(capability_contract) as digest
         from catalog_publication.candidates where id = $1`,
      [candidate.id],
    );
    return authorizePublish(asQueryable(client), {
      trustedActor: userActor(publisherUserId, publisherPermissions),
      candidate: {
        candidateId: candidate.id,
        artifactDigest: candidate.artifactDigest,
        expectedBaseReleaseId: candidate.expectedBaseReleaseId,
        expectedBaseReleaseDigest: candidate.expectedBaseReleaseDigest,
        proposalRevisionId: candidate.proposalRevisionId,
        impactReportDigest: candidate.impactReportDigest,
        capabilityContractDigest: capability.rows[0]!.digest,
      },
      impactFacts: facts,
      policyRevision,
    });
  });
  if (!authorized.ok) {
    throw new Error(`authorizePublish failed: ${JSON.stringify(authorized.error)}`);
  }
  const job = await asCoordinator(client, async () =>
    createJob(asQueryable(client), {
      id: PublicationJobId(`cjob_${token}`),
      candidateId: candidate.id,
      authorizationId: authorized.value.authorization.id,
      requestScope: input.requestScope ?? "instance:cp-05",
      idempotencyKey: `key-${token}`,
      requestDigest: sha256Digest(`req-${token}`),
    }),
  );
  if (!job.ok) {
    throw new Error(`createJob failed: ${JSON.stringify(job.error)}`);
  }
  const compiled = compileCatalogRelease(built.value.artifact.bundle);
  if (!compiled.ok) {
    throw new Error("successor bundle failed to compile");
  }
  const command: Extract<InstallPublishedReleaseCommand, { mode: "online-publication" }> = {
    mode: "online-publication",
    jobId: job.value.id,
    candidateId: candidate.id,
    authorizationId: authorized.value.authorization.id,
    expectedCurrent: {
      id: candidate.expectedBaseReleaseId,
      digest: candidate.expectedBaseReleaseDigest,
    },
    fencingToken: job.value.fencingToken,
    trustedActor: userActor(publisherUserId, publisherPermissions),
    impactFacts: facts,
  };
  return {
    token,
    policyRevision,
    built: built.value,
    candidate,
    authorization: authorized.value.authorization,
    job: job.value,
    compiled: compiled.value,
    command,
  };
}

export async function provisionOnlineActivation(pool: pg.Pool, client: pg.Client, propertyKey = "iin_min") {
  const predecessor = await bootstrapFirstAcme(pool);
  await persistPredecessorArtifact(client, predecessor);
  const prepared = await buildAuthorizedJob(client, {
    predecessorDigest: predecessor.digest,
    propertyKey,
  });
  return { predecessor, ...prepared };
}
