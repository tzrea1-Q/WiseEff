import type pg from "pg";
import { ApiError } from "../../../shared/http/errors";
import { CatalogReleaseDigest, CatalogReleaseId, CatalogSubjectId, SubjectRegistrationId } from "../../parameter-catalog-contract";
import type { UserInvocationContext } from "../../auth/trustedInvocation";
import { writeGuardedRegistration } from "../registration/internalGuardedRegistrationWriter";
import { auditRegistration } from "../registration/service";
import type { RegistrationCommand } from "../registration/command";

export type LifecycleChange = { subjectId: string; operation: "register" | "retire" | "restore"; registrationId?: string; kind: "driver" | "node-type" | "configuration-schema"; moduleId?: string; displayAlias?: string };

export async function applyLifecycle(client: pg.PoolClient, organizationId: string, invocation: UserInvocationContext, requestId: string, key: string, reason: string, changes: LifecycleChange[]) {
  const release = (await client.query<{ id: string; digest: string }>(`select r.id,r.release_digest as digest from parameter_catalog.catalog_state s
    join parameter_catalog.catalog_releases r on r.id=s.current_catalog_release_id where s.singleton`)).rows[0];
  if (!release) throw new ApiError("CONFLICT", "Catalog is unavailable.");
  for (const change of changes) {
    const context = { actorKind: "org-admin" as const, principalId: invocation.principal.user.id, invocation, requestId };
    const common = { organizationId, expectedRelease: { id: CatalogReleaseId(release.id), digest: CatalogReleaseDigest(release.digest) }, idempotencyKey: `module-structure:${key}:${change.subjectId}`, context };
    const command: RegistrationCommand = change.operation === "register"
      ? { ...common, kind: "register", subjectId: CatalogSubjectId(change.subjectId), subjectKind: change.kind,
        placement: { mode: "use-default" }, destinationModuleId: change.moduleId!, method: "explicit", proof: { reason },
        ...(change.displayAlias ? { displayAlias: change.displayAlias } : {}) }
      : { ...common, kind: change.operation, registrationId: SubjectRegistrationId(change.registrationId!), reason };
    const result = await writeGuardedRegistration(client, command);
    if (!result.ok) throw new ApiError("CONFLICT", "Subject lifecycle operation failed.", { subjectId: change.subjectId, failure: result.error });
    await auditRegistration(client, command, result.value, key);
  }
}
