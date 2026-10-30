import { createHash } from "node:crypto";
import type pg from "pg";
import type { z } from "zod";
import type { catalogBatchRegistrationRequestSchema } from "../../contracts/dtoSchemas/parameterCatalog";
import { CatalogSubjectId, type CatalogReleasePin } from "../../parameter-catalog-contract";
import { assertTrustedInvocationMatchesScope, type UserInvocationContext } from "../../auth/trustedInvocation";
import { asAuditTx, writeAuditEventInTx } from "../../audit/auditedWrite";
import { writeGuardedRegistration } from "./internalGuardedRegistrationWriter";
import { withRegistrationUnitOfWork } from "./unitOfWork";
import { mapWriterDatabaseError, type RegistrationFailure } from "./failures";
import type { RegistrationResult } from "./result";

type Rows = z.infer<typeof catalogBatchRegistrationRequestSchema>["rows"];
export type BatchRegistrationInput = { organizationId: string; rows: Rows; expectedRelease: CatalogReleasePin; idempotencyKey: string;
  actorKind: "org-admin" | "platform-admin"; principalId: string; invocation: UserInvocationContext; requestId: string };
export type BatchRowFailure = { index: number; subjectId: string; message: string };

function failureMessage(failure: RegistrationFailure): string {
  if (failure.kind === "placement-conflict" && failure.placementId === "parameter_modules_org_parent_name_unique_idx") return "同一分类下已有同名模块。";
  switch (failure.kind) {
    case "placement-occupied": return "目标模块已被占用。";
    case "placement-conflict": case "registration-conflict": case "restore-required": case "auto-restore-forbidden": return "主体已登记或放置已变化，请刷新。";
    case "invalid-placement-parent": return "业务分类不存在或不可用。";
    case "subject-retired": case "subject-not-published": return "主体在当前目录中未生效。";
    case "release-drift": case "catalog-drift": return "目录版本已变化，请刷新。";
    case "revision-conflict": return "请求已变化，请重新确认。";
    default: return "登记失败，请刷新后重试。";
  }
}

export async function executeBatchRegistration(pool: pg.Pool, input: BatchRegistrationInput) {
  const trusted = assertTrustedInvocationMatchesScope(input.invocation.principal, input.invocation, input.organizationId, "organization registration");
  if (trusted.initiator !== "user" || trusted.principal.user.id !== input.principalId || !input.requestId.trim()) throw new Error("批量登记需要可信的用户调用。");
  const fingerprint = createHash("sha256").update(JSON.stringify(input.rows)).digest("hex");
  const batchId = `batch_${createHash("sha256").update(JSON.stringify([input.organizationId, input.idempotencyKey])).digest("hex")}`;
  return withRegistrationUnitOfWork<RegistrationResult[], BatchRowFailure[]>(pool, async (client) => {
    const results: RegistrationResult[] = [];
    const failures: BatchRowFailure[] = [];
    for (const [index, row] of input.rows.entries()) {
      await client.query("savepoint batch_row");
      let failure: string | undefined;
      let result: RegistrationResult | undefined;
      try {
        const subject = await client.query<{ kind: "driver" | "node-type" | "configuration-schema" }>(
          "select kind from parameter_catalog.catalog_subjects where id = $1", [row.subjectId]);
        const kind = subject.rows[0]?.kind;
        const rowKey = `${input.idempotencyKey}:${index}`;
        const prior = await client.query<{ registered: boolean; replay: boolean }>(
          `select exists (select 1 from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2) as registered,
           exists (select 1 from parameter_catalog.governance_command_idempotency where organization_id=$1 and command_family='subject-registration' and idempotency_key=$3 and state='committed') as replay`,
          [input.organizationId, row.subjectId, rowKey]);
        if (!kind) failure = "主体在当前目录中未生效。";
        else if (prior.rows[0]?.registered && !prior.rows[0]?.replay) failure = "主体已登记，请刷新。";
        else {
          const target = row.target;
          let parentId: string | undefined;
          if (target.type !== "existing-module" && (!target.name.trim() || target.name !== target.name.trim() || target.name.length > 120 || /[\u0000-\u001f\u007f-\u009f]/u.test(target.name))) {
            failure = "请输入有效的模块名称（最多 120 字）。";
          } else if (target.type !== "existing-module") {
            const parent = target.type === "unclassified"
              ? await client.query<{ id: string }>("select id from public.parameter_modules where organization_id=$1 and kind='unclassified' and parent_id is null for update", [input.organizationId])
              : await client.query<{ id: string }>("select id from public.parameter_modules where organization_id=$1 and id=$2 and kind='business' for update", [input.organizationId, target.parentModuleId]);
            parentId = parent.rows[0]?.id;
            if (!parentId) failure = "业务分类不存在或不可用。";
          }
          if (!failure) {
            const moduleId = target.type === "existing-module" ? target.moduleId : `pmod_canonical_${createHash("sha256").update(JSON.stringify([input.organizationId, rowKey])).digest("hex").slice(0, 32)}`;
            const written = await writeGuardedRegistration(client, { kind: "register", organizationId: input.organizationId,
              subjectId: CatalogSubjectId(row.subjectId), subjectKind: kind, expectedRelease: input.expectedRelease,
              placement: { mode: "use-default" }, destinationModuleId: moduleId,
              ...(target.type === "existing-module" ? {} : { newDestination: { parentModuleId: parentId!, name: target.name } }),
              method: "explicit", proof: { reason: "batch-registration", batchFingerprint: fingerprint }, idempotencyKey: rowKey,
              context: { actorKind: input.actorKind, principalId: input.principalId, invocation: input.invocation, requestId: input.requestId } });
            if (!written.ok) failure = failureMessage(written.error);
            else if (written.value.outcome === "replayed" && !prior.rows[0]?.replay) failure = "主体已登记，请刷新。";
            else {
              result = written.value;
              await client.query("set constraints all immediate");
              await client.query("set constraints all deferred");
              if (result.outcome === "committed") await writeAuditEventInTx(asAuditTx(client), input.invocation, { requestId: input.requestId }, {
                app: "parameter-governance", kind: "parameter-catalog-registration", action: "registration-register", severity: "Medium",
                projectId: null, targetType: "organization-subject-registration", targetId: result.registrationId,
                metadata: { catalogReleaseId: input.expectedRelease.id, actorKind: input.actorKind, batchId },
              });
            }
          }
        }
      } catch (error) {
        const mapped = mapWriterDatabaseError(error, input.expectedRelease, row.subjectId);
        if (!mapped) throw error;
        failure = failureMessage(mapped);
      }
      if (failure) {
        await client.query("rollback to savepoint batch_row");
        failures.push({ index, subjectId: row.subjectId, message: failure });
      } else if (result) results.push(result);
      await client.query("release savepoint batch_row");
    }
    return failures.length ? { ok: false, error: failures } : { ok: true, value: results };
  }).then((result) => result.ok ? { ok: true as const, batchId, items: result.value } : result);
}
