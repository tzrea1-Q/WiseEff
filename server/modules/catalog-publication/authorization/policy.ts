import {
  assertTrustedInvocationContext,
  type TrustedInvocationContext,
} from "../../auth/trustedInvocation";
import type { Queryable } from "../../../shared/database/client";
import { getPolicy } from "../persistence/store";
import type { PublicationPolicyRecord } from "../persistence/types";
import {
  EPHEMERAL_POLICY_REVISION_CONFIRMATION,
  type PublicationAuthorizationResult,
  type RevisePublicationPolicyInput,
} from "./types";

const fail = (
  reason: "publication-policy-disabled" | "publication-not-authorized" | "publication-capability-missing",
  detail?: string,
): PublicationAuthorizationResult<never> => ({
  ok: false,
  error: detail ? { reason, detail } : { reason },
});

const isEphemeralTestDatabaseName = (name: string): boolean => {
  if (name.startsWith("wiseeff_test_wk_")) {
    return true;
  }
  return /^wiseeff_[a-z0-9]+_\d+_\d+$/i.test(name);
};

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

/**
 * Management wrapper around catalog_publication.revise_publication_policy.
 * Does not GRANT EXECUTE to the coordinator. Callers that are not
 * catalog_migration_owner receive SQLSTATE 42501. Publication is never
 * enabled on a shared / non-ephemeral database.
 */
export async function revisePublicationPolicy(
  db: Queryable,
  input: RevisePublicationPolicyInput,
): Promise<PublicationAuthorizationResult<PublicationPolicyRecord>> {
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

  const actorId = accountablePrincipalId(input.trustedActor);
  if (actorId === null) {
    return fail("publication-not-authorized", "policy revision requires a real user principal");
  }

  try {
    await db.query(
      `select catalog_publication.revise_publication_policy($1, $2, $3, $4)`,
      [
        input.publicationEnabled,
        input.lowRiskSingleActorPublish,
        input.capabilityContractRevision,
        actorId,
      ],
    );
  } catch (error) {
    const mapped = error as { code?: string; message?: string };
    if (mapped.code === "42501") {
      return fail(
        "publication-capability-missing",
        mapped.message ?? "revise_publication_policy execute denied",
      );
    }
    throw error;
  }

  const policy = await getPolicy(db);
  if (!policy.ok) {
    return fail("publication-policy-disabled", "publication policy is missing after revision");
  }
  return { ok: true, value: policy.value };
}
