/**
 * Publication job execute / recover (CP-07-D/E/F).
 *
 * Reconcile the exact Receipt for this job before calling the unique
 * synchronizer. Fence enters activation eligibility inside CP-05.
 * Lost commit responses reconcile; they do not declare terminal failure.
 */
import type pg from "pg";

import type { TrustedInvocationContext } from "../../auth/trustedInvocation";
import type { CatalogInstaller } from "../../catalog-kernel/install/installer";
import type { CatalogInstallError, CatalogInstallOutcome } from "../../catalog-kernel/install/publicationTypes";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import type { PublicationJobId } from "../../parameter-catalog-contract/index";
import type { Database, Queryable } from "../../../shared/database/client";
import type { ImpactFacts, ImpactOperationFact } from "../authorization/types";
import {
  getAuthorization,
  getCandidate,
  getJob,
  getReceiptByJobId,
  updateJobExecution,
} from "../persistence/store";
import type {
  CatalogActivationReceiptRecord,
  JsonObject,
  PublicationJobRecord,
  PublicationJobStatus,
} from "../persistence/types";
import { withPublicationCoordinator } from "../coordinator";

export type ResolvePublisherActor = (
  principalId: string,
) => Promise<TrustedInvocationContext | null>;

export type ExecutePublicationJobResult =
  | {
      readonly kind: "activated";
      readonly job: PublicationJobRecord;
      readonly currentness: "active" | "active-superseded";
      readonly recoveredFromReceipt: boolean;
    }
  | {
      readonly kind: "settled";
      readonly job: PublicationJobRecord;
    }
  | {
      readonly kind: "stale-fence";
      readonly job: PublicationJobRecord;
    }
  | {
      readonly kind: "empty";
    };

const RETRYABLE_ERROR_CLASSES = new Set(["lock-contention", "connectivity", "timeout"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseOperation = (value: unknown): ImpactOperationFact | null => {
  if (!isRecord(value) || typeof value.op !== "string") {
    return null;
  }
  if (value.op === "create-definition") {
    if (typeof value.supported !== "boolean") {
      return null;
    }
    return { op: "create-definition", supported: value.supported };
  }
  if (value.op === "create-subject-with-definitions") {
    return { op: "create-subject-with-definitions" };
  }
  if (value.op === "revise-definition") {
    if (value.class !== "documentation" && value.class !== "semantic") {
      return null;
    }
    return { op: "revise-definition", class: value.class };
  }
  if (value.op === "unknown") {
    if (typeof value.tag !== "string") {
      return null;
    }
    return { op: "unknown", tag: value.tag };
  }
  return null;
};

const BOOLEAN_FACT_KEYS = [
  "introducesNewSubject",
  "changesSelector",
  "changesAlias",
  "changesFallback",
  "tightensExistingContract",
  "changesUnitOrSemantic",
  "retiresIdentity",
  "unknownImpact",
] as const;

/**
 * Trusted allocation snapshot only. Missing or truncated facts fail closed as
 * tampered — never synthesize low-risk from authorPrincipalId alone.
 */
export function impactFactsFromAllocation(allocation: JsonObject): ImpactFacts | null {
  const facts = allocation.impactFacts;
  if (!isRecord(facts) || typeof facts.authorPrincipalId !== "string" || facts.authorPrincipalId.trim().length === 0) {
    return null;
  }
  if (!Array.isArray(facts.operations) || facts.operations.length === 0) {
    return null;
  }
  const operations: ImpactOperationFact[] = [];
  for (const entry of facts.operations) {
    const parsed = parseOperation(entry);
    if (parsed === null) {
      return null;
    }
    operations.push(parsed);
  }
  const booleans: Record<(typeof BOOLEAN_FACT_KEYS)[number], boolean> = {
    introducesNewSubject: false,
    changesSelector: false,
    changesAlias: false,
    changesFallback: false,
    tightensExistingContract: false,
    changesUnitOrSemantic: false,
    retiresIdentity: false,
    unknownImpact: false,
  };
  for (const key of BOOLEAN_FACT_KEYS) {
    const value = facts[key];
    if (typeof value !== "boolean") {
      return null;
    }
    booleans[key] = value;
  }
  if (
    facts.sourceKind !== "typed-changeset" &&
    facts.sourceKind !== "vendor-yaml" &&
    facts.sourceKind !== "repository-bundle" &&
    facts.sourceKind !== "adopted-preexisting"
  ) {
    return null;
  }
  return {
    authorPrincipalId: facts.authorPrincipalId,
    operations,
    ...booleans,
    sourceKind: facts.sourceKind,
  };
}

const receiptMatchesJob = (
  receipt: CatalogActivationReceiptRecord,
  job: PublicationJobRecord,
): boolean =>
  receipt.publicationJobId === job.id &&
  receipt.candidateId === job.candidateId &&
  receipt.authorizationId === job.authorizationId &&
  receipt.kind === "online-publication";

const currentnessOf = async (
  pool: pg.Pool,
  receipt: CatalogActivationReceiptRecord,
): Promise<"active" | "active-superseded"> => {
  const pointer = await readCurrentCatalogPointer(pool);
  if (
    pointer.kind === "installed" &&
    pointer.current.id === receipt.releaseId &&
    pointer.current.digest === receipt.releaseDigest
  ) {
    return "active";
  }
  return "active-superseded";
};

const settleActivated = async (
  coordinator: Queryable,
  job: PublicationJobRecord,
): Promise<PublicationJobRecord> => {
  if (job.status === "active") {
    return job;
  }
  const updated = await updateJobExecution(coordinator, job.id, {
    status: "active",
    lastErrorClass: null,
    lastErrorReason: null,
    expectedFencingToken: job.fencingToken,
  });
  if (updated.ok) {
    return updated.value;
  }
  const latest = await getJob(coordinator, job.id);
  return latest.ok ? latest.value : job;
};

const settleFailure = async (
  coordinator: Queryable,
  job: PublicationJobRecord,
  status: Extract<
    PublicationJobStatus,
    "needs-rebase" | "blocked" | "failed-retryable" | "failed-terminal"
  >,
  errorClass: string,
  reason: string,
  retryBudget: number,
): Promise<PublicationJobRecord> => {
  const nextStatus =
    status === "failed-retryable" && job.attemptCount >= retryBudget ? "failed-terminal" : status;
  const updated = await updateJobExecution(coordinator, job.id, {
    status: nextStatus,
    lastErrorClass: errorClass,
    lastErrorReason: reason,
    expectedFencingToken: job.fencingToken,
  });
  if (updated.ok) {
    return updated.value;
  }
  if (updated.error.kind === "conflict") {
    const latest = await getJob(coordinator, job.id);
    return latest.ok ? latest.value : job;
  }
  return job;
};

const classifyInstallError = (
  error: CatalogInstallError,
): {
  readonly status: Extract<
    PublicationJobStatus,
    "needs-rebase" | "blocked" | "failed-retryable" | "failed-terminal"
  >;
  readonly errorClass: string;
  readonly reason: string;
} => {
  if (error.kind === "needs-rebase" || error.kind === "unsupported-lineage") {
    return { status: "needs-rebase", errorClass: "lineage", reason: "needs-rebase" };
  }
  if (error.kind === "fencing-token-mismatch") {
    return { status: "failed-retryable", errorClass: "fence", reason: "fencing-token-mismatch" };
  }
  if (error.kind === "activation-receipt-mismatch") {
    return { status: "blocked", errorClass: "receipt", reason: "activation-receipt-mismatch" };
  }
  if (error.kind === "artifact-missing") {
    return { status: "failed-terminal", errorClass: "artifact", reason: "artifact-missing" };
  }
  if (error.kind === "predecessor-incomplete") {
    return { status: "failed-terminal", errorClass: "artifact", reason: "predecessor-incomplete" };
  }
  if (error.kind === "adoption-evidence-invalid") {
    return { status: "failed-terminal", errorClass: "adoption", reason: "adoption-evidence-invalid" };
  }
  if (error.kind === "publication-not-authorized") {
    const reason = error.reason;
    if (
      reason === "publication-frozen" ||
      reason === "publication-authorization-revoked" ||
      reason === "publication-policy-disabled" ||
      reason === "publication-capability-missing" ||
      reason === "candidate-stale"
    ) {
      return { status: "blocked", errorClass: "authorization", reason };
    }
    return { status: "failed-terminal", errorClass: "authorization", reason };
  }
  if (error.kind === "synchronization-busy" || (error.kind === "storage-failure" && error.retryable)) {
    return { status: "failed-retryable", errorClass: "lock-contention", reason: error.kind };
  }
  if (error.kind === "storage-failure") {
    return { status: "failed-terminal", errorClass: "storage", reason: "storage-failure" };
  }
  return { status: "failed-terminal", errorClass: "activation", reason: error.kind };
};

const appendFailureAudit = async (
  db: Queryable,
  jobId: PublicationJobId,
  reason: string,
  errorClass: string,
): Promise<void> => {
  try {
    await db.query(
      `insert into public.audit_events (
         id, organization_id, project_id, actor_user_id, actor_type, app, kind, action,
         severity, target_type, target_id, metadata, trace_id
       ) values (
         $1, null, null, null, 'system', 'catalog-publication', 'catalog-publication-job',
         'job-failure', 'warning', 'publication-job', $2, $3::jsonb, $2
       )`,
      [
        `audit_${jobId}_${Date.now()}`,
        jobId,
        JSON.stringify({ reason, errorClass }),
      ],
    );
  } catch {
    // Mutable job row keeps last_error_*; audit is best-effort and must not
    // leak DSN/SQL. Coordinator may lack INSERT on audit_events.
  }
};

export async function recoverPublicationJobFromReceipt(
  coordinator: Queryable,
  pool: pg.Pool,
  job: PublicationJobRecord,
): Promise<ExecutePublicationJobResult | null> {
  const receipt = await getReceiptByJobId(coordinator, job.id);
  if (!receipt.ok) {
    if (receipt.error.kind === "not-found") {
      return null;
    }
    return {
      kind: "settled",
      job: await settleFailure(
        coordinator,
        job,
        "blocked",
        "receipt",
        "activation-receipt-mismatch",
        Number.MAX_SAFE_INTEGER,
      ),
    };
  }
  if (!receiptMatchesJob(receipt.value, job)) {
    return {
      kind: "settled",
      job: await settleFailure(
        coordinator,
        job,
        "blocked",
        "receipt",
        "activation-receipt-mismatch",
        Number.MAX_SAFE_INTEGER,
      ),
    };
  }
  const settled = await settleActivated(coordinator, job);
  return {
    kind: "activated",
    job: settled,
    currentness: await currentnessOf(pool, receipt.value),
    recoveredFromReceipt: true,
  };
}

export async function executeClaimedPublicationJob(input: {
  readonly db: Database;
  readonly pool: pg.Pool;
  readonly installer: CatalogInstaller;
  readonly claimed: PublicationJobRecord;
  readonly resolvePublisherActor: ResolvePublisherActor;
  readonly retryBudget: number;
}): Promise<ExecutePublicationJobResult> {
  const recovered = await withPublicationCoordinator(input.db, (tx) =>
    recoverPublicationJobFromReceipt(tx, input.pool, input.claimed),
  );
  if (recovered) {
    return recovered;
  }

  const latest = await withPublicationCoordinator(input.db, (tx) => getJob(tx, input.claimed.id));
  if (!latest.ok) {
    return { kind: "empty" };
  }
  if (latest.value.fencingToken !== input.claimed.fencingToken) {
    return { kind: "stale-fence", job: latest.value };
  }

  const prepared = await withPublicationCoordinator(input.db, async (tx) => {
    const job = latest.value;
    const candidate = await getCandidate(tx, job.candidateId);
    if (!candidate.ok) {
      return { ok: false as const, settle: { status: "failed-terminal" as const, errorClass: "candidate", reason: "candidate-stale" } };
    }
    const authorization = await getAuthorization(tx, job.authorizationId);
    if (!authorization.ok || authorization.value.eventKind !== "approve") {
      return { ok: false as const, settle: { status: "failed-terminal" as const, errorClass: "authorization", reason: "publication-not-authorized" } };
    }
    const facts = impactFactsFromAllocation(candidate.value.identityAllocation);
    if (facts === null) {
      return { ok: false as const, settle: { status: "failed-terminal" as const, errorClass: "candidate", reason: "candidate-tampered" } };
    }
    return {
      ok: true as const,
      job,
      candidate: candidate.value,
      authorization: authorization.value,
      facts,
    };
  });

  if (!prepared.ok) {
    const settled = await withPublicationCoordinator(input.db, (tx) =>
      settleFailure(
        tx,
        input.claimed,
        prepared.settle.status,
        prepared.settle.errorClass,
        prepared.settle.reason,
        input.retryBudget,
      ),
    );
    await withPublicationCoordinator(input.db, (tx) =>
      appendFailureAudit(tx, settled.id, prepared.settle.reason, prepared.settle.errorClass),
    );
    return { kind: "settled", job: settled };
  }

  const actor = await input.resolvePublisherActor(prepared.authorization.actorPrincipalId);
  if (actor === null) {
    const settled = await withPublicationCoordinator(input.db, (tx) =>
      settleFailure(
        tx,
        prepared.job,
        "blocked",
        "authorization",
        "publication-capability-missing",
        input.retryBudget,
      ),
    );
    return { kind: "settled", job: settled };
  }

  let outcome: { ok: true; value: CatalogInstallOutcome } | { ok: false; error: CatalogInstallError } | "unknown";
  try {
    outcome = await input.installer.installPublishedRelease({
      mode: "online-publication",
      jobId: prepared.job.id,
      candidateId: prepared.candidate.id,
      authorizationId: prepared.authorization.id,
      expectedCurrent: {
        id: prepared.candidate.expectedBaseReleaseId,
        digest: prepared.candidate.expectedBaseReleaseDigest,
      },
      fencingToken: prepared.job.fencingToken,
      trustedActor: actor,
      impactFacts: prepared.facts,
    });
  } catch {
    outcome = "unknown";
  }

  if (outcome === "unknown") {
    const afterUnknown = await withPublicationCoordinator(input.db, (tx) =>
      recoverPublicationJobFromReceipt(tx, input.pool, prepared.job),
    );
    if (afterUnknown) {
      return afterUnknown;
    }
    const retryable = await withPublicationCoordinator(input.db, (tx) =>
      settleFailure(
        tx,
        prepared.job,
        "failed-retryable",
        "connectivity",
        "activation-commit-unknown",
        input.retryBudget,
      ),
    );
    return { kind: "settled", job: retryable };
  }

  if (outcome.ok) {
    if (outcome.value.status === "already-recorded" || outcome.value.status === "installed") {
      const after = await withPublicationCoordinator(input.db, async (tx) => {
        if (outcome.value.status === "already-recorded") {
          const recoveredAfter = await recoverPublicationJobFromReceipt(
            tx,
            input.pool,
            prepared.job,
          );
          if (recoveredAfter) {
            return recoveredAfter;
          }
        }
        const job = await settleActivated(tx, prepared.job);
        return {
          kind: "activated" as const,
          job,
          currentness:
            outcome.value.status === "already-recorded"
              ? outcome.value.currentness
              : ("active" as const),
          recoveredFromReceipt: outcome.value.status === "already-recorded",
        };
      });
      return after;
    }
    const settled = await withPublicationCoordinator(input.db, (tx) =>
      settleFailure(
        tx,
        prepared.job,
        "failed-retryable",
        "activation",
        outcome.value.status,
        input.retryBudget,
      ),
    );
    return { kind: "settled", job: settled };
  }

  if (outcome.error.kind === "fencing-token-mismatch") {
    const current = await withPublicationCoordinator(input.db, (tx) => getJob(tx, prepared.job.id));
    return { kind: "stale-fence", job: current.ok ? current.value : prepared.job };
  }

  const classified = classifyInstallError(outcome.error);
  const settled = await withPublicationCoordinator(input.db, (tx) =>
    settleFailure(
      tx,
      prepared.job,
      classified.status,
      classified.errorClass,
      classified.reason,
      input.retryBudget,
    ),
  );
  if (!RETRYABLE_ERROR_CLASSES.has(classified.errorClass)) {
    await withPublicationCoordinator(input.db, (tx) =>
      appendFailureAudit(tx, settled.id, classified.reason, classified.errorClass),
    );
  }
  return { kind: "settled", job: settled };
}
