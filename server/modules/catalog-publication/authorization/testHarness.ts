import type pg from "pg";

import { createUserInvocation, createAgentInvocation, createSystemInvocation } from "../../auth/trustedInvocation";
import type { AuthContext, BackendPermission } from "../../auth/types";
import { makeTestAuthContext } from "../../../testing/authContext";
import {
  CATALOG_MIGRATION_OWNER,
  CATALOG_PUBLICATION_COORDINATOR_ROLE,
  quoteIdent,
} from "../../catalog-kernel/security/catalogRoleManifest";
import {
  CatalogArtifactId,
  CatalogCandidateId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  DefinitionProposalId,
  DefinitionProposalRevisionId,
  PublicationPolicyRevision,
} from "../../parameter-catalog-contract/index";
import {
  asQueryable,
  sha256Digest,
  uniqueToken,
  withCommittedRole,
} from "../persistence/integrationHarness";
import { persistArtifact, persistCandidate } from "../persistence/store";
import type { ArtifactSourceKind, JsonObject, PublicationCandidateRecord } from "../persistence/types";
import { revisePublicationPolicy } from "./policy";
import { lowRiskCreateDefinitionFacts } from "./classify";
import type { AuthorizationCandidateTuple, ImpactFacts } from "./types";
import { EPHEMERAL_POLICY_REVISION_CONFIRMATION } from "./types";

export const AUTHOR = "user-catalog-author";
export const PUBLISHER = "user-catalog-publisher";
export const REVIEWER = "user-catalog-reviewer";
export const ORG_ADMIN = "user-org-admin";

export const publisherPermissions: readonly BackendPermission[] = ["catalog:publish", "parameter:view"];
export const reviewerPermissions: readonly BackendPermission[] = [
  "catalog:review-high-risk",
  "parameter:view",
];
export const authorPermissions: readonly BackendPermission[] = ["catalog:author", "parameter:view"];

export function authContext(input: {
  userId: string;
  permissions: readonly BackendPermission[];
  roleId?: AuthContext["roles"][number]["roleId"];
  isActive?: boolean;
}): AuthContext {
  return makeTestAuthContext({
    userId: input.userId,
    roleId: input.roleId ?? "admin",
    permissions: input.permissions,
    isActive: input.isActive,
    name: input.userId,
  });
}

export const userActor = (
  userId: string,
  permissions: readonly BackendPermission[],
  extras: { isActive?: boolean; roleId?: AuthContext["roles"][number]["roleId"] } = {},
) => createUserInvocation(authContext({ userId, permissions, ...extras }));

export const agentActor = (permissions: readonly BackendPermission[]) =>
  createAgentInvocation(authContext({ userId: AUTHOR, permissions }), {
    sessionId: "session-catalog",
    toolCallId: "tool-catalog",
    approval: { required: true, approvalId: "approval-catalog" },
  });

export const systemActor = () => createSystemInvocation({ kind: "job", name: "publication-worker" });

export async function capabilityDigest(
  client: pg.Client,
  candidateId: CatalogCandidateId,
): Promise<string> {
  const digest = await client.query<{ digest: string }>(
    `select catalog_publication.digest_jsonb(capability_contract) as digest
     from catalog_publication.candidates
     where id = $1`,
    [candidateId],
  );
  const value = digest.rows[0]?.digest;
  if (!value) {
    throw new Error("capability digest missing");
  }
  return value;
}

export async function tupleOf(
  client: pg.Client,
  candidate: PublicationCandidateRecord,
): Promise<AuthorizationCandidateTuple> {
  return {
    candidateId: candidate.id,
    artifactDigest: candidate.artifactDigest,
    expectedBaseReleaseId: candidate.expectedBaseReleaseId,
    expectedBaseReleaseDigest: candidate.expectedBaseReleaseDigest,
    proposalRevisionId: candidate.proposalRevisionId,
    impactReportDigest: candidate.impactReportDigest,
    capabilityContractDigest: await capabilityDigest(client, candidate.id),
  };
}

export async function persistHandBuiltCandidate(
  client: pg.Client,
  options: {
    token?: string;
    authorPrincipalId?: string;
    authorOrganizationId?: string;
    impactFacts?: ImpactFacts | { readonly [key: string]: unknown };
    sourceKind?: ArtifactSourceKind;
    impactReportDigest?: string;
    proposalId?: DefinitionProposalId | null;
    proposalRevisionId?: DefinitionProposalRevisionId | null;
  } = {},
): Promise<PublicationCandidateRecord> {
  const token = options.token ?? uniqueToken("cand");
  const bytes = new Uint8Array(Buffer.from(`bytes-${token}`));
  const db = asQueryable(client);
  const artifact = await persistArtifact(db, {
    id: CatalogArtifactId(`cart_${token}`),
    artifactDigest: sha256Digest(`aggregate-${token}`),
    artifactBytes: bytes,
    sourceKind: options.sourceKind ?? "typed-changeset",
    targetReleaseId: CatalogReleaseId(`crel_target_${token}`),
    targetReleaseDigest: CatalogReleaseDigest(sha256Digest(`target-${token}`)),
    predecessorReleaseId: CatalogReleaseId(`crel_pred_${token}`),
    predecessorReleaseDigest: CatalogReleaseDigest(sha256Digest(`pred-${token}`)),
    toolchain: { compiler: "cp-04-test" },
  });
  if (!artifact.ok) {
    throw new Error(`persistArtifact failed: ${JSON.stringify(artifact.error)}`);
  }
  const candidate = await persistCandidate(db, {
    id: CatalogCandidateId(`ccand_${token}`),
    artifactId: artifact.value.id,
    expectedBaseReleaseId: CatalogReleaseId(`crel_base_${token}`),
    expectedBaseReleaseDigest: CatalogReleaseDigest(sha256Digest(`base-${token}`)),
    proposalId: options.proposalId ?? null,
    proposalRevisionId: options.proposalRevisionId ?? null,
    identityAllocation: {
      authorPrincipalId: options.authorPrincipalId ?? AUTHOR,
      ...(options.authorOrganizationId ? { authorOrganizationId: options.authorOrganizationId } : {}),
      ...(options.impactFacts ? { impactFacts: options.impactFacts as unknown as JsonObject } : {}),
      frozen: true,
    },
    impactReportDigest: options.impactReportDigest ?? sha256Digest(`impact-${token}`),
    capabilityContract: { revision: "catalog-capability/v1" },
  });
  if (!candidate.ok) {
    throw new Error(`persistCandidate failed: ${JSON.stringify(candidate.error)}`);
  }
  return candidate.value;
}

export async function enablePublicationPolicy(
  client: pg.Client,
  flags: { publicationEnabled: boolean; lowRiskSingleActorPublish: boolean },
  actorUserId = PUBLISHER,
): Promise<PublicationPolicyRevision> {
  const revised = await withCommittedRole(client, CATALOG_MIGRATION_OWNER, async () =>
    revisePublicationPolicy(asQueryable(client), {
      trustedActor: userActor(actorUserId, publisherPermissions),
      publicationEnabled: flags.publicationEnabled,
      lowRiskSingleActorPublish: flags.lowRiskSingleActorPublish,
      capabilityContractRevision: "catalog-capability/v1",
      isolatedInstanceConfirmation: EPHEMERAL_POLICY_REVISION_CONFIRMATION,
    }),
  );
  if (!revised.ok) {
    throw new Error(`revisePublicationPolicy failed: ${JSON.stringify(revised.error)}`);
  }
  return revised.value.revision;
}

export async function asCoordinator<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  await client.query("begin");
  await client.query(`set local role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
  try {
    const result = await fn();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.query("reset role").catch(() => undefined);
  }
}

export const lowFacts = (authorPrincipalId = AUTHOR): ImpactFacts =>
  lowRiskCreateDefinitionFacts(authorPrincipalId);

export const highFacts = (authorPrincipalId = AUTHOR): ImpactFacts => ({
  ...lowRiskCreateDefinitionFacts(authorPrincipalId),
  introducesNewSubject: true,
  operations: [{ op: "create-subject-with-definitions" }],
});
