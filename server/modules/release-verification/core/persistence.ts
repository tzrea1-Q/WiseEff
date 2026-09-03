import type { Database } from "../../../shared/database/client";
import type { VerificationPurpose } from "../../parameter-catalog-contract/index";
import { refusal, type VerificationRefusal } from "./errors";
import { prepareLockMaterial, subjectKey, verificationLockKeys } from "./lock";
import type {
  ApprovalPrincipalKind,
  GateResult,
  ReleaseApprovalRecord,
  ReleaseVerificationReport,
  TypedEvidenceRef,
  VerificationAttemptSnapshot,
  VerificationPlan,
  VerificationSubject,
} from "./types";
import {
  VerificationApprovalId,
  VerificationAttemptDigest,
  VerificationAttemptId,
  VerificationPlanDigest,
  VerificationPlanId,
  VerificationReportDigest,
  VerificationReportId,
} from "./types";

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: string }).code === "23505";

const isAppendOnlyViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: string }).code === "55000";

type PlanRow = {
  id: string;
  digest: string;
  canonical_bytes: string;
  purpose: VerificationPurpose;
  mode: VerificationPlan["mode"];
  subject: VerificationSubject;
  lineage: VerificationPlan["lineage"];
  pins: VerificationPlan["pins"];
  evidence_requirements: VerificationPlan["evidenceRequirements"];
  registry_digest: string;
  applicability_profile: VerificationPlan["applicabilityProfile"];
  created_at: Date | string;
};

type AttemptRow = {
  id: string;
  digest: string;
  plan_id: string;
  plan_digest: string;
  purpose: VerificationPurpose;
  created_at: Date | string;
};

type GateResultRow = {
  gate_id: string;
  status: GateResult["status"];
  failure_code: string | null;
  evidence_digest: string | null;
  successor_purpose: VerificationPurpose | null;
  not_applicable_proof: string | null;
};

type ReportRow = {
  id: string;
  digest: string;
  canonical_bytes: string;
  plan_id: string;
  plan_digest: string;
  attempt_id: string;
  attempt_digest: string;
  purpose: VerificationPurpose;
  mode: VerificationPlan["mode"];
  decision: ReleaseVerificationReport["decision"];
  results: readonly GateResult[];
  evidence_refs: readonly TypedEvidenceRef[];
  registry_digest: string;
  assembled_at: Date | string;
};

type ApprovalRow = {
  id: string;
  report_id: string;
  report_digest: string;
  purpose: VerificationPurpose;
  principal_kind: ApprovalPrincipalKind;
  principal_id: string;
  approved_at: Date | string;
};

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

const mapPlan = (row: PlanRow): VerificationPlan => ({
  id: VerificationPlanId(row.id),
  digest: VerificationPlanDigest(row.digest),
  canonicalBytes: row.canonical_bytes,
  purpose: row.purpose,
  mode: row.mode,
  subject: row.subject,
  lineage: row.lineage,
  pins: row.pins,
  evidenceRequirements: row.evidence_requirements,
  registryDigest: row.registry_digest as VerificationPlan["registryDigest"],
  gateSelectionSource: "registry",
  applicabilityProfile: row.applicability_profile,
  createdAt: asIso(row.created_at),
});

const mapAttempt = (
  row: AttemptRow,
  results: readonly GateResult[],
): VerificationAttemptSnapshot => ({
  id: VerificationAttemptId(row.id),
  digest: VerificationAttemptDigest(row.digest),
  planId: VerificationPlanId(row.plan_id),
  planDigest: VerificationPlanDigest(row.plan_digest),
  purpose: row.purpose,
  results,
  createdAt: asIso(row.created_at),
});

const mapReport = (row: ReportRow): ReleaseVerificationReport => ({
  id: VerificationReportId(row.id),
  digest: VerificationReportDigest(row.digest),
  canonicalBytes: row.canonical_bytes,
  planId: VerificationPlanId(row.plan_id),
  planDigest: VerificationPlanDigest(row.plan_digest),
  attemptId: VerificationAttemptId(row.attempt_id),
  attemptDigest: VerificationAttemptDigest(row.attempt_digest),
  purpose: row.purpose,
  mode: row.mode,
  decision: row.decision,
  results: row.results,
  evidenceRefs: row.evidence_refs,
  registryDigest: row.registry_digest as ReleaseVerificationReport["registryDigest"],
  assembledAt: asIso(row.assembled_at),
});

const mapApproval = (row: ApprovalRow): ReleaseApprovalRecord => ({
  id: VerificationApprovalId(row.id),
  reportId: VerificationReportId(row.report_id),
  reportDigest: VerificationReportDigest(row.report_digest),
  purpose: row.purpose,
  principalKind: row.principal_kind,
  principalId: row.principal_id,
  approvedAt: asIso(row.approved_at),
});

const mapGateRow = (row: GateResultRow): GateResult => ({
  gateId: row.gate_id as GateResult["gateId"],
  status: row.status,
  failureCode: row.failure_code,
  evidenceDigest: row.evidence_digest,
  successorPurpose: row.successor_purpose,
  notApplicableProof: row.not_applicable_proof,
});

export async function tryAdvisoryLock(
  db: Database,
  scope: "prepare" | "run",
  material: string,
): Promise<boolean> {
  const [classKey, objectKey] = verificationLockKeys(scope, material);
  const result = await db.query<{ locked: boolean }>(
    "select pg_catalog.pg_try_advisory_xact_lock($1, $2) as locked",
    [classKey, objectKey],
  );
  return result.rows[0]?.locked === true;
}

export async function findPlanByDigest(
  db: Database,
  digest: string,
): Promise<VerificationPlan | null> {
  const result = await db.query<PlanRow>(
    `select id, digest, canonical_bytes, purpose, mode, subject, lineage, pins,
            evidence_requirements, registry_digest, applicability_profile, created_at
     from parameter_catalog.verification_plans
     where digest = $1`,
    [digest],
  );
  const row = result.rows[0];
  return row ? mapPlan(row) : null;
}

export async function insertPlan(
  db: Database,
  plan: VerificationPlan,
): Promise<{ ok: true; plan: VerificationPlan } | { ok: false; error: VerificationRefusal }> {
  const material = prepareLockMaterial(plan.purpose, plan.subject, plan.lineage.phaseSnapshot);
  const locked = await tryAdvisoryLock(db, "prepare", material);
  if (!locked) {
    return { ok: false, error: refusal("concurrent-conflict", "prepare lock held for this purpose") };
  }
  const existing = await findPlanByDigest(db, plan.digest);
  if (existing) {
    return { ok: true, plan: existing };
  }
  try {
    await db.query(
      `insert into parameter_catalog.verification_plans (
         id, digest, canonical_bytes, purpose, mode, subject_key, subject, lineage, pins,
         evidence_requirements, registry_digest, applicability_profile
       ) values (
         $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12::jsonb
       )`,
      [
        plan.id,
        plan.digest,
        plan.canonicalBytes,
        plan.purpose,
        plan.mode,
        subjectKey(plan.subject),
        JSON.stringify(plan.subject),
        JSON.stringify(plan.lineage),
        JSON.stringify(plan.pins),
        JSON.stringify(plan.evidenceRequirements),
        plan.registryDigest,
        JSON.stringify(plan.applicabilityProfile),
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: refusal("concurrent-conflict", "plan digest already stored") };
    }
    throw error;
  }
  const stored = await findPlanByDigest(db, plan.digest);
  if (!stored) {
    throw new Error("Verification plan insert did not persist");
  }
  return { ok: true, plan: stored };
}

export async function insertAttempt(
  db: Database,
  attempt: VerificationAttemptSnapshot,
): Promise<{ ok: true } | { ok: false; error: VerificationRefusal }> {
  const locked = await tryAdvisoryLock(db, "run", attempt.planDigest);
  if (!locked) {
    return { ok: false, error: refusal("concurrent-conflict", "run lock held for this plan") };
  }
  try {
    await db.query(
      `insert into parameter_catalog.verification_attempts (
         id, digest, plan_id, plan_digest, purpose
       ) values ($1, $2, $3, $4, $5)`,
      [attempt.id, attempt.digest, attempt.planId, attempt.planDigest, attempt.purpose],
    );
    for (const result of attempt.results) {
      await db.query(
        `insert into parameter_catalog.verification_gate_results (
           attempt_id, gate_id, status, failure_code, evidence_digest,
           successor_purpose, not_applicable_proof
         ) values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          attempt.id,
          result.gateId,
          result.status,
          result.failureCode,
          result.evidenceDigest,
          result.successorPurpose,
          result.notApplicableProof,
        ],
      );
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: refusal("concurrent-conflict", "attempt insert conflicted") };
    }
    throw error;
  }
  return { ok: true };
}

export async function loadAttemptResults(
  db: Database,
  attemptId: string,
): Promise<readonly GateResult[]> {
  const result = await db.query<GateResultRow>(
    `select gate_id, status, failure_code, evidence_digest, successor_purpose, not_applicable_proof
     from parameter_catalog.verification_gate_results
     where attempt_id = $1
     order by gate_id`,
    [attemptId],
  );
  return result.rows.map(mapGateRow);
}

export async function findLatestAttempt(
  db: Database,
  planDigest: string,
): Promise<VerificationAttemptSnapshot | null> {
  const result = await db.query<AttemptRow>(
    `select id, digest, plan_id, plan_digest, purpose, created_at
     from parameter_catalog.verification_attempts
     where plan_digest = $1
     order by created_at desc, id desc
     limit 1`,
    [planDigest],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return mapAttempt(row, await loadAttemptResults(db, row.id));
}

export async function insertReport(
  db: Database,
  report: ReleaseVerificationReport,
): Promise<{ ok: true; report: ReleaseVerificationReport } | { ok: false; error: VerificationRefusal }> {
  try {
    await db.query(
      `insert into parameter_catalog.verification_reports (
         id, digest, canonical_bytes, plan_id, plan_digest, attempt_id, attempt_digest,
         purpose, mode, decision, results, evidence_refs, registry_digest
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13
       )`,
      [
        report.id,
        report.digest,
        report.canonicalBytes,
        report.planId,
        report.planDigest,
        report.attemptId,
        report.attemptDigest,
        report.purpose,
        report.mode,
        report.decision,
        JSON.stringify(report.results),
        JSON.stringify(report.evidenceRefs),
        report.registryDigest,
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: refusal("append-only-conflict", "report already assembled") };
    }
    throw error;
  }
  const stored = await findReport(db, report.digest);
  if (!stored || stored.kind !== "row") {
    throw new Error("Verification report insert did not persist");
  }
  return { ok: true, report: stored.report };
}

export type StoredReport =
  | { readonly kind: "row"; readonly report: ReleaseVerificationReport }
  | { readonly kind: "missing" };

export async function findReport(
  db: Database,
  reportIdOrDigest: string,
): Promise<StoredReport> {
  const result = await db.query<ReportRow>(
    `select id, digest, canonical_bytes, plan_id, plan_digest, attempt_id, attempt_digest,
            purpose, mode, decision, results, evidence_refs, registry_digest, assembled_at
     from parameter_catalog.verification_reports
     where id = $1 or digest = $1`,
    [reportIdOrDigest],
  );
  const row = result.rows[0];
  if (!row) {
    return { kind: "missing" };
  }
  return { kind: "row", report: mapReport(row) };
}

export async function listApprovals(
  db: Database,
  reportDigest: string,
): Promise<readonly ReleaseApprovalRecord[]> {
  const result = await db.query<ApprovalRow>(
    `select id, report_id, report_digest, purpose, principal_kind, principal_id, approved_at
     from parameter_catalog.verification_approvals
     where report_digest = $1
     order by approved_at, principal_kind`,
    [reportDigest],
  );
  return result.rows.map(mapApproval);
}

export async function insertApproval(
  db: Database,
  approval: ReleaseApprovalRecord,
): Promise<{ ok: true; approval: ReleaseApprovalRecord } | { ok: false; error: VerificationRefusal }> {
  try {
    const result = await db.query<ApprovalRow>(
      `insert into parameter_catalog.verification_approvals (
         id, report_id, report_digest, purpose, principal_kind, principal_id
       ) values ($1, $2, $3, $4, $5, $6)
       returning id, report_id, report_digest, purpose, principal_kind, principal_id, approved_at`,
      [
        approval.id,
        approval.reportId,
        approval.reportDigest,
        approval.purpose,
        approval.principalKind,
        approval.principalId,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Verification approval insert did not persist");
    }
    return { ok: true, approval: mapApproval(row) };
  } catch (error) {
    if (isUniqueViolation(error) || isAppendOnlyViolation(error)) {
      const detail =
        error instanceof Error ? error.message : "approval insert rejected";
      if (detail.includes("distinct")) {
        return {
          ok: false,
          error: refusal("distinct-principals-required", "operator and platform-owner must differ"),
        };
      }
      return { ok: false, error: refusal("append-only-conflict", "approval already recorded") };
    }
    throw error;
  }
}

export async function countReportsForAttempt(db: Database, attemptId: string): Promise<number> {
  const result = await db.query<{ n: string }>(
    `select count(*)::text as n
     from parameter_catalog.verification_reports
     where attempt_id = $1`,
    [attemptId],
  );
  return Number(result.rows[0]?.n ?? 0);
}
