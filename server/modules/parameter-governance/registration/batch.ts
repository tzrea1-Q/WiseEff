import { createHash } from "node:crypto";
import type pg from "pg";
import type { z } from "zod";
import type { catalogBatchRegistrationRequestSchema } from "../../contracts/dtoSchemas/parameterCatalog";
import { CatalogSubjectId, type CatalogReleasePin } from "../../parameter-catalog-contract";
import { TrustedInvocationContextError, type UserInvocationContext } from "../../auth/trustedInvocation";
import { validateRegistrationCommand, type RegisterSubjectCommand } from "./command";
import { assertRegistrationInvocation, auditRegistration } from "./service";
import { writeGuardedRegistration } from "./internalGuardedRegistrationWriter";
import { lockOrganizationRegistrations } from "./repositories";
import { withRegistrationUnitOfWork } from "./unitOfWork";
import { mapWriterDatabaseError, type RegistrationFailure } from "./failures";
import type { RegistrationResult } from "./result";

type Rows = z.infer<typeof catalogBatchRegistrationRequestSchema>["rows"];
export type BatchRegistrationInput = { organizationId: string; rows: Rows; expectedRelease: CatalogReleasePin; idempotencyKey: string;
  actorKind: "org-admin" | "platform-admin"; principalId: string; invocation: UserInvocationContext; requestId: string };
export type BatchRowFailure = { index: number; subjectId: string; code: "category-missing" | "name-invalid" | "already-registered" | "subject-inactive" | "owned-child" | "release-drift" | "conflict"; field: "category" | "name" | "subject" };

function failureReason(failure: RegistrationFailure): Pick<BatchRowFailure, "code" | "field"> {
  switch (failure.kind) {
    case "registration-conflict": case "restore-required": case "auto-restore-forbidden": return { code: "already-registered", field: "subject" };
    case "invalid-placement-parent": return { code: "category-missing", field: "category" };
    case "subject-retired": case "subject-not-published": return { code: "subject-inactive", field: "subject" };
    case "release-drift": case "catalog-drift": return { code: "release-drift", field: "subject" };
    case "invalid-command": if (failure.reason === "displayAlias") return { code: "name-invalid", field: "name" }; break;
  }
  return { code: "conflict", field: "subject" };
}

export async function executeBatchRegistration(pool: pg.Pool, input: BatchRegistrationInput) {
  if (!input.invocation) throw new TrustedInvocationContextError("Organization registration requires a trusted user invocation");
  assertRegistrationInvocation({ organizationId: input.organizationId, context: { actorKind: input.actorKind, principalId: input.principalId, invocation: input.invocation, requestId: input.requestId } });
  const fingerprint = createHash("sha256").update(JSON.stringify(input.rows)).digest("hex");
  const batchId = `batch_${createHash("sha256").update(JSON.stringify([input.organizationId, input.idempotencyKey])).digest("hex")}`;
  return withRegistrationUnitOfWork<RegistrationResult[], BatchRowFailure[]>(pool, async (client) => {
    await lockOrganizationRegistrations(client, input.organizationId);
    const results: RegistrationResult[] = [];
    const failures: BatchRowFailure[] = [];
    for (const [index, row] of input.rows.entries()) {
      await client.query("savepoint batch_row");
      let failure: Pick<BatchRowFailure, "code" | "field"> | undefined;
      let result: RegistrationResult | undefined;
      try {
        const subject = await client.query<{ kind: "driver" | "node-type" | "configuration-schema"; owner_subject_id: string | null }>(
          "select kind, owner_subject_id from parameter_catalog.catalog_subjects where id = $1", [row.subjectId]);
        const kind = subject.rows[0]?.kind;
        const rowKey = `${input.idempotencyKey}:${index}`;
        const prior = await client.query<{ registered: boolean; replay: boolean }>(
          `select exists (select 1 from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2) as registered,
           exists (select 1 from parameter_catalog.governance_command_idempotency where organization_id=$1 and command_family='subject-registration' and idempotency_key=$3 and state='committed') as replay`,
          [input.organizationId, row.subjectId, rowKey]);
        if (!kind) failure = { code: "subject-inactive", field: "subject" };
        else if (subject.rows[0]?.owner_subject_id) failure = { code: "owned-child", field: "subject" };
        else if (prior.rows[0]?.registered && !prior.rows[0]?.replay) failure = { code: "already-registered", field: "subject" };
        else {
          const target = row.target;
          if (!failure) {
            const command: RegisterSubjectCommand = { kind: "register", organizationId: input.organizationId,
              subjectId: CatalogSubjectId(row.subjectId), subjectKind: kind, expectedRelease: input.expectedRelease,
              placement: { mode: "use-default" }, destinationModuleId: target.moduleId,
              ...(row.displayAlias ? { displayAlias: row.displayAlias } : {}),
              method: "explicit", proof: { reason: "batch-registration", batchFingerprint: fingerprint }, idempotencyKey: rowKey,
              context: { actorKind: input.actorKind, principalId: input.principalId, invocation: input.invocation, requestId: input.requestId } };
            const validated = validateRegistrationCommand(command);
            const written = validated.ok ? await writeGuardedRegistration(client, validated.value) : validated;
            if (!written.ok) failure = failureReason(written.error);
            else if (written.value.outcome === "replayed" && !prior.rows[0]?.replay) failure = { code: "already-registered", field: "subject" };
            else {
              result = written.value;
              // Surface deferred constraint violations inside this row's savepoint.
              await client.query("set constraints all immediate");
              await client.query("set constraints all deferred");
              await auditRegistration(client, command, result, batchId);
              const { cascadedRegistrations: _cascadedRegistrations, ...publicResult } = result;
              result = publicResult;
            }
          }
        }
      } catch (error) {
        const mapped = mapWriterDatabaseError(error, input.expectedRelease, row.subjectId);
        if (!mapped) throw error;
        failure = failureReason(mapped);
      }
      if (failure) {
        await client.query("rollback to savepoint batch_row");
        failures.push({ index, subjectId: row.subjectId, ...failure });
      } else if (result) results.push(result);
      await client.query("release savepoint batch_row");
    }
    return failures.length ? { ok: false, error: failures } : { ok: true, value: results };
  }).then((result) => result.ok ? { ok: true as const, batchId, items: result.value } : result);
}
