import {
  assertTrustedInvocationContext,
  type TrustedInvocationContext,
} from "../../auth/trustedInvocation";
import type { Queryable } from "../../../shared/database/client";
import { getPolicy } from "../persistence/store";
import type { PublicationPolicyRecord } from "../persistence/types";
import { collectPublicationPolicyInstanceSnapshot } from "./instanceSnapshot";
import { isEphemeralTestDatabaseName } from "./policyNames";
import type {
  ManagedInstancePolicyPins,
  PublicationAuthorizationResult,
  PublicationPolicyCheckResult,
  PublicationPolicyInstanceSnapshot,
  PublicationPolicyRevisionFailureReason,
  RevisePublicationPolicyInput,
} from "./types";
import { EPHEMERAL_POLICY_REVISION_CONFIRMATION } from "./types";

const fail = (
  reason: PublicationPolicyRevisionFailureReason,
  detail?: string,
): PublicationAuthorizationResult<never> => ({
  ok: false,
  error: detail ? { reason, detail } : { reason },
});

const accountablePrincipalId = (actor: TrustedInvocationContext): string | null => {
  const trusted = assertTrustedInvocationContext(actor);
  if (trusted.initiator !== "user") {
    return null;
  }
  if (!trusted.principal.user.isActive) {
    return null;
  }
  return trusted.principal.user.id;
};

const pinsMatchSnapshot = (
  snapshot: PublicationPolicyInstanceSnapshot,
  pins: ManagedInstancePolicyPins,
): { ok: true } | { ok: false; detail: string } => {
  if (pins.confirmation !== "managed-instance-policy-revision") {
    return { ok: false, detail: "managed instance policy revision requires managed-instance confirmation" };
  }
  if (snapshot.databaseOid.length === 0 || pins.expectedDatabaseOid !== snapshot.databaseOid) {
    return { ok: false, detail: "database oid does not match the observed instance" };
  }
  if ((snapshot.currentReleaseId ?? "") !== pins.expectedCurrentId) {
    return { ok: false, detail: "current catalog release id does not match the observed instance" };
  }
  if ((snapshot.currentReleaseDigest ?? "") !== pins.expectedCurrentDigest) {
    return { ok: false, detail: "current catalog digest does not match the observed instance" };
  }
  if (snapshot.policyRevision !== pins.expectedPolicyRevision) {
    return { ok: false, detail: "publication policy revision is stale" };
  }
  if (snapshot.frozen !== pins.expectedFrozen) {
    return { ok: false, detail: "publication freeze state does not match the observed instance" };
  }
  if (snapshot.adopted !== pins.expectedAdopted) {
    return { ok: false, detail: "catalog adoption state does not match the observed instance" };
  }
  return { ok: true };
};

export const evaluateManagedPolicyRevision = (input: {
  readonly snapshot: PublicationPolicyInstanceSnapshot;
  readonly pins: ManagedInstancePolicyPins;
  readonly publicationEnabled: boolean;
}): readonly { readonly reason: PublicationPolicyRevisionFailureReason; readonly detail: string }[] => {
  const refusals: { reason: PublicationPolicyRevisionFailureReason; detail: string }[] = [];
  const matched = pinsMatchSnapshot(input.snapshot, input.pins);
  if (!matched.ok) {
    refusals.push({ reason: "publication-instance-stale", detail: matched.detail });
  }
  if (input.publicationEnabled && !input.snapshot.adopted) {
    refusals.push({
      reason: "adoption-evidence-invalid",
      detail: "online publication cannot be enabled before exact Catalog adoption",
    });
  }
  return refusals;
};

const writePolicyRevision = async (
  db: Queryable,
  input: {
    readonly publicationEnabled: boolean;
    readonly lowRiskSingleActorPublish: boolean;
    readonly capabilityContractRevision: string;
    readonly actorId: string;
  },
): Promise<PublicationAuthorizationResult<PublicationPolicyRecord>> => {
  try {
    await db.query(`select catalog_publication.revise_publication_policy($1, $2, $3, $4)`, [
      input.publicationEnabled,
      input.lowRiskSingleActorPublish,
      input.capabilityContractRevision,
      input.actorId,
    ]);
  } catch (error) {
    const mapped = error as { code?: string; message?: string };
    if (mapped.code === "42501") {
      return fail("publication-capability-missing", mapped.message ?? "revise_publication_policy execute denied");
    }
    throw error;
  }

  const policy = await getPolicy(db);
  if (!policy.ok) {
    return fail("publication-policy-disabled", "publication policy is missing after revision");
  }
  return { ok: true, value: policy.value };
};

export async function inspectPublicationPolicy(
  db: Queryable,
): Promise<PublicationPolicyInstanceSnapshot> {
  return collectPublicationPolicyInstanceSnapshot(db);
}

export async function checkPublicationPolicyRevision(
  db: Queryable,
  input: Extract<RevisePublicationPolicyInput, { managedInstance: ManagedInstancePolicyPins }>,
): Promise<PublicationAuthorizationResult<PublicationPolicyCheckResult>> {
  const actorId = accountablePrincipalId(input.trustedActor);
  if (actorId === null) {
    return fail("publication-not-authorized", "policy revision requires a real user principal");
  }
  const snapshot = await collectPublicationPolicyInstanceSnapshot(db);
  const refusals = evaluateManagedPolicyRevision({
    snapshot,
    pins: input.managedInstance,
    publicationEnabled: input.publicationEnabled,
  });
  return {
    ok: true,
    value: {
      snapshot,
      action: input.publicationEnabled ? "enable" : "disable",
      intended: {
        publicationEnabled: input.publicationEnabled,
        lowRiskSingleActorPublish: input.lowRiskSingleActorPublish,
      },
      refusals,
    },
  };
}

/**
 * Management wrapper around catalog_publication.revise_publication_policy.
 * Does not GRANT EXECUTE to the coordinator. Callers that are not
 * catalog_migration_owner receive SQLSTATE 42501.
 *
 * Ephemeral confirmation remains isolated-test-only.
 * Managed instances require observed identity pins; enable does not clear freeze
 * and does not require a prior online publication.
 */
export async function revisePublicationPolicy(
  db: Queryable,
  input: RevisePublicationPolicyInput,
): Promise<PublicationAuthorizationResult<PublicationPolicyRecord>> {
  const actorId = accountablePrincipalId(input.trustedActor);
  if (actorId === null) {
    return fail("publication-not-authorized", "policy revision requires a real user principal");
  }

  if ("isolatedInstanceConfirmation" in input) {
    if (input.isolatedInstanceConfirmation !== EPHEMERAL_POLICY_REVISION_CONFIRMATION) {
      return fail(
        "publication-policy-disabled",
        "publication policy revision requires an ephemeral-test confirmation",
      );
    }
    const database = await db.query<{ current_database: string }>("select current_database()");
    const databaseName = database.rows[0]?.current_database ?? "";
    if (!isEphemeralTestDatabaseName(databaseName)) {
      return fail(
        "publication-policy-disabled",
        "publication policy cannot be enabled on a shared database",
      );
    }
    return writePolicyRevision(db, {
      publicationEnabled: input.publicationEnabled,
      lowRiskSingleActorPublish: input.lowRiskSingleActorPublish,
      capabilityContractRevision: input.capabilityContractRevision,
      actorId,
    });
  }

  const snapshot = await collectPublicationPolicyInstanceSnapshot(db);
  const refusals = evaluateManagedPolicyRevision({
    snapshot,
    pins: input.managedInstance,
    publicationEnabled: input.publicationEnabled,
  });
  if (input.mode === "check") {
    return fail(
      refusals[0]?.reason ?? "publication-policy-disabled",
      "policy check does not write; call inspectPublicationPolicy or checkPublicationPolicyRevision",
    );
  }
  if (refusals.length > 0) {
    return fail(refusals[0]!.reason, refusals[0]!.detail);
  }
  return writePolicyRevision(db, {
    publicationEnabled: input.publicationEnabled,
    lowRiskSingleActorPublish: input.lowRiskSingleActorPublish,
    capabilityContractRevision: input.capabilityContractRevision,
    actorId,
  });
}
