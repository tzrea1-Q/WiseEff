import type { Database, Queryable } from "../../shared/database/client";
import type { UserInvocationContext } from "../auth/trustedInvocation";
import { CatalogCandidateId, PublicationJobId } from "../parameter-catalog-contract";
import { previewPublicationCandidate } from "./preview";
import { enqueuePublicationJob } from "./enqueue";
import { getCandidate, getJob, getReceiptByJobId } from "./persistence/store";

export type ImportDriverDeclaration = {
  ref: string; compatible: string; driverNature: "physical-device" | "logical-service";
  instanceCardinality: "multiple" | "singleton-per-project";
};

/** Read-only observation: the API never installs a release or trusts a mutable job status as receipt. */
export async function observeModuleDriverPublication(db: Queryable, organizationId: string, candidateId: string, jobId: string) {
  const candidate = await getCandidate(db, CatalogCandidateId(candidateId));
  const job = await getJob(db, PublicationJobId(jobId));
  if (!candidate.ok || candidate.value.identityAllocation.authorOrganizationId !== organizationId || !job.ok
    || job.value.candidateId !== candidateId) return { phase: "blocked" as const, message: "发布身份记录不一致，请联系管理员。" };
  const receipt = await getReceiptByJobId(db, job.value.id);
  if (receipt.ok && receipt.value.kind === "online-publication" && receipt.value.publicationJobId === jobId
    && receipt.value.candidateId === candidateId && receipt.value.authorizationId === job.value.authorizationId) {
    return { phase: "ready" as const, allocation: candidate.value.identityAllocation.subjects };
  }
  if (["blocked", "failed-terminal", "needs-rebase", "cancelled"].includes(job.value.status)) {
    const reason = job.value.lastErrorReason ?? job.value.status;
    return { phase: "blocked" as const, message: `驱动发布尚未生效（${reason}）。处理失败原因后，重新预览并明确点击重新发布驱动；模块与组织登记尚未应用。` };
  }
  return { phase: "publishing" as const, message: "驱动正在发布；完成后请审阅并确认模块与组织登记。" };
}

/** Called inside the import-owned transaction; all allocation, approval and enqueue writes commit together. */
export async function enqueueModuleDriverPublication(input: {
  db: Database; organizationId: string; exportId: string; predecessorDigest: string;
  invocation: UserInvocationContext; drivers: ImportDriverDeclaration[]; previousJobId?: string;
}) {
  const role = (await input.db.query<{ role: string }>("select current_role as role")).rows[0]!.role;
  try {
    if (input.previousJobId) {
      await input.db.query("set local role catalog_publication_coordinator_role");
      const previous = (await input.db.query<{ status: string }>("select status from catalog_publication.publication_jobs where id=$1 for update", [input.previousJobId])).rows[0];
      const receipt = await getReceiptByJobId(input.db, PublicationJobId(input.previousJobId));
      if (!previous || receipt.ok || !["blocked", "failed-terminal", "needs-rebase", "cancelled"].includes(previous.status))
        return { ok: false as const, reason: "publication-state-changed" };
    }
    const candidate = await previewPublicationCandidate({ db: input.db, predecessorDigest: input.predecessorDigest,
      authorPrincipalId: input.invocation.principal.user.id, authorOrganizationId: input.organizationId,
      changeSet: input.drivers.map(driver => ({ op: "create-subject" as const, kind: "driver" as const,
        canonicalKey: `driver:${driver.compatible}`, selector: { kind: "driver-compatible" as const, value: driver.compatible },
        nature: driver.driverNature, cardinality: driver.instanceCardinality })) });
    if (!candidate.ok) return { ok: false as const, reason: candidate.error.kind };
    const job = await enqueuePublicationJob({ db: input.db, candidateId: candidate.value.candidate.id,
      requestScope: `organization:${input.organizationId}:module-driver-import`,
      idempotencyKey: `${input.exportId}:${candidate.value.candidate.id}`, trustedActor: input.invocation });
    if (!job.ok) return { ok: false as const, reason: job.error.kind === "authorization" ? job.error.reason : job.error.kind };
    const subjects = candidate.value.candidate.identityAllocation.subjects;
    const allocations = Array.isArray(subjects) ? subjects : [];
    const mapping: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const driver of input.drivers) {
      const allocation = allocations.find(entry => entry !== null && typeof entry === "object" && !Array.isArray(entry)
        && entry.canonicalKey === `driver:${driver.compatible}`);
      if (!allocation || typeof allocation !== "object" || Array.isArray(allocation) || typeof allocation.subjectId !== "string")
        return { ok: false as const, reason: "candidate-tampered" };
      mapping[driver.ref] = allocation.subjectId;
    }
    return { ok: true as const, candidateId: candidate.value.candidate.id, jobId: job.value.job.id, mapping };
  } finally {
    // Nested savepoints do not restore SET LOCAL ROLE after successful release.
    await input.db.query(`set local role "${role.replaceAll('"', '""')}"`);
  }
}
