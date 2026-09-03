import { randomUUID } from "node:crypto";
import type { Result } from "../../parameter-catalog-contract/index";
import { canonicalBytes, digestOf } from "./digest";
import { refusal, type VerificationRefusal } from "./errors";
import {
  MISSING_APPLICABLE_GATE_FAILURE,
  gateRegistryDigest,
  parseVerificationMode,
  parseVerificationPurpose,
  purposeProfile,
} from "./gateRegistry";
import {
  countReportsForAttempt,
  findLatestAttempt,
  findPlanByDigest,
  findReport,
  insertApproval,
  insertAttempt,
  insertPlan,
  insertReport,
  listApprovals,
} from "./persistence";
import type { Database } from "../../../shared/database/client";
import type {
  ApprovalCommand,
  ApprovalPrincipalKind,
  GateAdapter,
  GateResult,
  PrepareVerificationInput,
  PurposeGateProfileEntry,
  ReadReportResult,
  ReleaseApprovalRecord,
  ReleaseVerificationReport,
  TypedEvidenceRef,
  VerificationAttemptSnapshot,
  VerificationPlan,
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

const FORBIDDEN_CONTROL_KEYS = new Set([
  "gates",
  "gateIds",
  "gateList",
  "gateSelection",
  "waiver",
  "waive",
  "waived",
  "skip",
  "skipped",
  "skippedAsWaived",
]);

const EVIDENCE_REQUIREMENT_KEYS = [
  "recoveryPointDigest",
  "mappingEpoch",
  "cutoverPlanDigest",
  "acceptanceContractDigest",
] as const;

const PURPOSES_REQUIRING_APPROVAL = new Set([
  "pre-activation",
  "post-retirement-runtime",
  "public-release",
  "legacy-read-sunset",
  "p16-cleanup",
]);

export type ReleaseVerificationService = {
  prepareVerification(
    input: PrepareVerificationInput,
  ): Promise<Result<VerificationPlan, VerificationRefusal>>;
  runVerification(
    planDigest: string,
  ): Promise<Result<VerificationAttemptSnapshot, VerificationRefusal>>;
  assembleReport(
    planDigest: string,
    typedEvidenceRefs: readonly TypedEvidenceRef[],
  ): Promise<Result<ReleaseVerificationReport, VerificationRefusal>>;
  approveReport(
    reportDigest: string,
    approvalCommand: ApprovalCommand,
  ): Promise<Result<ReleaseApprovalRecord, VerificationRefusal>>;
  readReport(reportIdOrDigest: string): Promise<ReadReportResult>;
};

const opaqueId = (prefix: string): string => `${prefix}${randomUUID().replaceAll("-", "")}`;

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const collectForbiddenKeys = (value: unknown, found: string[]): void => {
  const record = asRecord(value);
  if (!record) {
    return;
  }
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_CONTROL_KEYS.has(key)) {
      found.push(key);
    }
    collectForbiddenKeys(record[key], found);
  }
};

const inspectCallerControl = (input: PrepareVerificationInput): VerificationRefusal | null => {
  const found: string[] = [];
  collectForbiddenKeys(input, found);
  if (found.length === 0) {
    return null;
  }
  if (found.some((key) => key.startsWith("waiv") || key.startsWith("skip"))) {
    return refusal("waiver-forbidden", `caller supplied ${found.join(",")}`);
  }
  return refusal("caller-gate-selection-forbidden", `caller supplied ${found.join(",")}`);
};

const inspectEvidenceRequirements = (
  requirements: PrepareVerificationInput["evidenceRequirements"],
): VerificationRefusal | null => {
  const record = asRecord(requirements);
  if (!record) {
    return refusal("caller-gate-selection-forbidden", "evidenceRequirements must be a typed object");
  }
  const keys = Object.keys(record);
  const extra = keys.filter(
    (key) => !EVIDENCE_REQUIREMENT_KEYS.includes(key as (typeof EVIDENCE_REQUIREMENT_KEYS)[number]),
  );
  if (extra.length > 0) {
    if (extra.some((key) => FORBIDDEN_CONTROL_KEYS.has(key))) {
      return inspectCallerControl({ evidenceRequirements: requirements } as PrepareVerificationInput);
    }
    return refusal("caller-gate-selection-forbidden", `unexpected evidence keys ${extra.join(",")}`);
  }
  return null;
};

const planCanonicalPayload = (
  plan: Omit<VerificationPlan, "id" | "digest" | "canonicalBytes" | "createdAt">,
) => ({
  applicabilityProfile: plan.applicabilityProfile,
  evidenceRequirements: plan.evidenceRequirements,
  gateSelectionSource: "registry",
  lineage: plan.lineage,
  mode: plan.mode,
  pins: plan.pins,
  purpose: plan.purpose,
  registryDigest: plan.registryDigest,
  subject: plan.subject,
});

const resultCanonical = (result: GateResult) => ({
  evidenceDigest: result.evidenceDigest,
  failureCode: result.failureCode,
  gateId: result.gateId,
  notApplicableProof: result.notApplicableProof,
  status: result.status,
  successorPurpose: result.successorPurpose,
});

const reportCanonicalPayload = (
  report: Omit<ReleaseVerificationReport, "id" | "digest" | "canonicalBytes" | "assembledAt">,
) => ({
  attemptDigest: report.attemptDigest,
  decision: report.decision,
  evidenceRefs: report.evidenceRefs,
  mode: report.mode,
  planDigest: report.planDigest,
  purpose: report.purpose,
  registryDigest: report.registryDigest,
  results: report.results.map(resultCanonical),
});

const defaultAdapter = async (input: {
  readonly gate: PurposeGateProfileEntry;
}): Promise<GateResult> => {
  const { gate } = input;
  if (gate.applicability.status === "not-yet-executable") {
    return {
      gateId: gate.gateId,
      status: "not-yet-executable",
      failureCode: null,
      evidenceDigest: null,
      successorPurpose: gate.applicability.successorPurpose,
      notApplicableProof: null,
    };
  }
  if (gate.applicability.status === "not-applicable") {
    return {
      gateId: gate.gateId,
      status: "not-applicable",
      failureCode: null,
      evidenceDigest: null,
      successorPurpose: null,
      notApplicableProof: gate.applicability.proof,
    };
  }
  return {
    gateId: gate.gateId,
    status: "failed",
    failureCode: MISSING_APPLICABLE_GATE_FAILURE,
    evidenceDigest: null,
    successorPurpose: null,
    notApplicableProof: null,
  };
};

const executeProfile = async (
  plan: VerificationPlan,
  adapters: ReadonlyMap<string, GateAdapter>,
): Promise<readonly GateResult[]> => {
  const results: GateResult[] = [];
  for (const gate of plan.applicabilityProfile) {
    const adapter = adapters.get(gate.gateId);
    if (adapter) {
      const executed = await adapter({ gateId: gate.gateId, plan });
      if (
        gate.applicability.status !== "required-now" &&
        executed.status === "passed"
      ) {
        results.push(await defaultAdapter({ gate }));
        continue;
      }
      results.push(executed);
      continue;
    }
    results.push(await defaultAdapter({ gate }));
  }
  return results;
};

const profileCovered = (
  profile: readonly PurposeGateProfileEntry[],
  results: readonly GateResult[],
): boolean => {
  if (results.length !== profile.length) {
    return false;
  }
  const byId = new Map(results.map((result) => [result.gateId, result]));
  return profile.every((entry) => {
    const result = byId.get(entry.gateId);
    return result !== undefined && result.status !== undefined;
  });
};

const hasForbiddenResultStatus = (results: readonly GateResult[]): boolean =>
  results.some((result) => {
    const status = result.status as string;
    return status === "waived" || status === "skipped" || status === "skipped-as-waived";
  });

const requiredNowPassed = (
  profile: readonly PurposeGateProfileEntry[],
  results: readonly GateResult[],
): boolean => {
  const byId = new Map(results.map((result) => [result.gateId, result]));
  return profile.every((entry) => {
    if (entry.applicability.status !== "required-now") {
      return true;
    }
    return byId.get(entry.gateId)?.status === "passed";
  });
};

const approvalsComplete = (
  purpose: VerificationPlan["purpose"],
  approvals: readonly ReleaseApprovalRecord[],
): boolean => {
  if (!PURPOSES_REQUIRING_APPROVAL.has(purpose)) {
    return true;
  }
  const kinds = new Set(approvals.map((approval) => approval.principalKind));
  return kinds.has("operator") && kinds.has("platform-owner");
};

export const createReleaseVerificationService = (options: {
  readonly db: Database;
  readonly adapters?: ReadonlyMap<string, GateAdapter>;
}): ReleaseVerificationService => {
  const adapters = options.adapters ?? new Map<string, GateAdapter>();

  const prepareVerification = async (
    input: PrepareVerificationInput,
  ): Promise<Result<VerificationPlan, VerificationRefusal>> => {
    const callerControl = inspectCallerControl(input) ?? inspectEvidenceRequirements(input.evidenceRequirements);
    if (callerControl) {
      return { ok: false, error: callerControl };
    }
    const purpose = parseVerificationPurpose(input.purpose);
    if (!purpose) {
      return { ok: false, error: refusal("unknown-purpose", input.purpose) };
    }
    const mode = parseVerificationMode(input.mode);
    if (!mode) {
      return { ok: false, error: refusal("unknown-mode", input.mode) };
    }
    const applicabilityProfile = purposeProfile(purpose, mode);
    const draft: Omit<VerificationPlan, "id" | "digest" | "canonicalBytes" | "createdAt"> = {
      purpose,
      mode,
      subject: input.subject,
      lineage: input.lineage,
      pins: input.pins,
      evidenceRequirements: input.evidenceRequirements,
      registryDigest: gateRegistryDigest(),
      gateSelectionSource: "registry",
      applicabilityProfile,
    };
    const payload = planCanonicalPayload(draft);
    const planBytes = canonicalBytes(payload);
    const planDigest = digestOf(payload);

    return options.db.transaction(async (tx) => {
      const existing = await findPlanByDigest(tx, planDigest);
      if (existing) {
        return { ok: true as const, value: existing };
      }
      const plan: VerificationPlan = {
        ...draft,
        id: VerificationPlanId(opaqueId("vplan_")),
        digest: VerificationPlanDigest(planDigest),
        canonicalBytes: planBytes,
        createdAt: new Date().toISOString(),
      };
      const inserted = await insertPlan(tx, plan);
      if (!inserted.ok) {
        return inserted;
      }
      return { ok: true as const, value: inserted.plan };
    });
  };

  const runVerification = async (
    planDigest: string,
  ): Promise<Result<VerificationAttemptSnapshot, VerificationRefusal>> => {
    return options.db.transaction(async (tx) => {
      const plan = await findPlanByDigest(tx, planDigest);
      if (!plan) {
        return { ok: false as const, error: refusal("plan-not-found", planDigest) };
      }
      const results = await executeProfile(plan, adapters);
      if (hasForbiddenResultStatus(results)) {
        return {
          ok: false as const,
          error: refusal("waiver-forbidden", "gate executor produced a waived or skipped status"),
        };
      }
      const attemptPayload = {
        planDigest: plan.digest,
        purpose: plan.purpose,
        results: results.map(resultCanonical),
      };
      const attempt: VerificationAttemptSnapshot = {
        id: VerificationAttemptId(opaqueId("vattempt_")),
        digest: VerificationAttemptDigest(digestOf(attemptPayload)),
        planId: plan.id,
        planDigest: plan.digest,
        purpose: plan.purpose,
        results,
        createdAt: new Date().toISOString(),
      };
      const inserted = await insertAttempt(tx, attempt);
      if (!inserted.ok) {
        return inserted;
      }
      return { ok: true as const, value: attempt };
    });
  };

  const assembleReport = async (
    planDigest: string,
    typedEvidenceRefs: readonly TypedEvidenceRef[],
  ): Promise<Result<ReleaseVerificationReport, VerificationRefusal>> => {
    const forbiddenEvidence = typedEvidenceRefs.some(
      (ref) => !ref.digest || ref.digest.length === 0 || FORBIDDEN_CONTROL_KEYS.has(ref.gateId),
    );
    if (forbiddenEvidence) {
      return { ok: false, error: refusal("evidence-pin-mismatch", "evidence refs must be typed digests") };
    }
    return options.db.transaction(async (tx) => {
      const plan = await findPlanByDigest(tx, planDigest);
      if (!plan) {
        return { ok: false as const, error: refusal("plan-not-found", planDigest) };
      }
      const attempt = await findLatestAttempt(tx, plan.digest);
      if (!attempt || !profileCovered(plan.applicabilityProfile, attempt.results)) {
        return {
          ok: false as const,
          error: refusal("incomplete-attempt", "purpose profile is not fully recorded"),
        };
      }
      if (await countReportsForAttempt(tx, attempt.id) > 0) {
        return {
          ok: false as const,
          error: refusal("append-only-conflict", "attempt already assembled"),
        };
      }
      const decision = requiredNowPassed(plan.applicabilityProfile, attempt.results)
        ? "passed"
        : "blocked";
      const draft = {
        planId: plan.id,
        planDigest: plan.digest,
        attemptId: attempt.id,
        attemptDigest: attempt.digest,
        purpose: plan.purpose,
        mode: plan.mode,
        decision: decision as ReleaseVerificationReport["decision"],
        results: attempt.results,
        evidenceRefs: typedEvidenceRefs,
        registryDigest: plan.registryDigest,
      };
      const report: ReleaseVerificationReport = {
        ...draft,
        id: VerificationReportId(opaqueId("vreport_")),
        digest: VerificationReportDigest(digestOf(reportCanonicalPayload(draft))),
        canonicalBytes: canonicalBytes(reportCanonicalPayload(draft)),
        assembledAt: new Date().toISOString(),
      };
      const inserted = await insertReport(tx, report);
      if (!inserted.ok) {
        if (inserted.error.kind === "append-only-conflict") {
          return {
            ok: false as const,
            error: refusal("half-report-forbidden", "refusing to rewrite or split a report"),
          };
        }
        return inserted;
      }
      return { ok: true as const, value: inserted.report };
    });
  };

  const approveReport = async (
    reportDigest: string,
    approvalCommand: ApprovalCommand,
  ): Promise<Result<ReleaseApprovalRecord, VerificationRefusal>> => {
    if (approvalCommand.principalKind === "verifier") {
      return {
        ok: false,
        error: refusal("verifier-signature-is-not-approval", "verifier signatures cannot approve"),
      };
    }
    if (
      approvalCommand.principalKind !== "operator" &&
      approvalCommand.principalKind !== "platform-owner"
    ) {
      return {
        ok: false,
        error: refusal("wrong-principal", "approval principal must be operator or platform-owner"),
      };
    }
    return options.db.transaction(async (tx) => {
      const stored = await findReport(tx, reportDigest);
      if (stored.kind === "missing") {
        return { ok: false as const, error: refusal("plan-not-found", reportDigest) };
      }
      const report = stored.report;
      if (approvalCommand.purpose !== report.purpose) {
        return {
          ok: false as const,
          error: refusal("wrong-purpose", "approval purpose must match the report"),
        };
      }
      if (!PURPOSES_REQUIRING_APPROVAL.has(report.purpose)) {
        return {
          ok: false as const,
          error: refusal(
            "approval-not-applicable",
            "isolated-candidate-acceptance is technical evidence only",
          ),
        };
      }
      if (report.decision !== "passed") {
        return { ok: false as const, error: refusal("report-not-passed", report.digest) };
      }
      const existing = await listApprovals(tx, report.digest);
      const other = existing.find(
        (approval) =>
          approval.principalKind !== approvalCommand.principalKind &&
          approval.principalId === approvalCommand.principalId,
      );
      if (other) {
        return {
          ok: false as const,
          error: refusal("distinct-principals-required", "operator and platform-owner must differ"),
        };
      }
      const duplicate = existing.find(
        (approval) => approval.principalKind === approvalCommand.principalKind,
      );
      if (duplicate) {
        return {
          ok: false as const,
          error: refusal("append-only-conflict", "principal kind already approved this report"),
        };
      }
      const inserted = await insertApproval(tx, {
        id: VerificationApprovalId(opaqueId("vapproval_")),
        reportId: report.id,
        reportDigest: report.digest,
        purpose: report.purpose,
        principalKind: approvalCommand.principalKind as ApprovalPrincipalKind,
        principalId: approvalCommand.principalId,
        approvedAt: new Date().toISOString(),
      });
      if (!inserted.ok) {
        return inserted;
      }
      return { ok: true as const, value: inserted.approval };
    });
  };

  const readReport = async (reportIdOrDigest: string): Promise<ReadReportResult> => {
    const stored = await findReport(options.db, reportIdOrDigest);
    if (stored.kind === "missing") {
      return { kind: "absent", reason: "missing" };
    }
    const approvals = await listApprovals(options.db, stored.report.digest);
    if (!approvalsComplete(stored.report.purpose, approvals)) {
      return { kind: "absent", reason: "unapproved" };
    }
    return { kind: "present", report: stored.report };
  };

  return {
    prepareVerification,
    runVerification,
    assembleReport,
    approveReport,
    readReport,
  };
};


