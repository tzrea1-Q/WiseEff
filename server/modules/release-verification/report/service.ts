import type { Result } from "../../parameter-catalog-contract/index";
import { createReleaseVerificationService } from "../core/service";
import { findPlanByDigest, findReport, listApprovals } from "../core/persistence";
import { digestOf } from "../core/digest";
import type { Database } from "../../../shared/database/client";
import type {
  ApprovalCommand,
  ReadReportResult,
  ReleaseApprovalRecord,
  ReleaseVerificationReport,
  TypedEvidenceRef,
} from "../core/types";
import { asReportRefusal, reportRefusal, type ReportRefusal } from "./errors";
import { canonicalReportDigest, reportDigestIsDeterministic } from "./digest";
import { inspectExactLineage, storedReportLineageIsExact } from "./lineage";
import {
  reportRetentionBlocksPresent,
  systemRetentionClock,
  type RetentionClock,
} from "./retention";
import {
  createStartupRuntimePinReader,
  readApprovedRuntimePin,
  type RuntimePinQuery,
  type RuntimePinResult,
  type StartupRuntimePinReader,
} from "./runtimePin";

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

export type VerificationReportService = {
  assembleReport(
    planDigest: string,
    typedEvidenceRefs: readonly TypedEvidenceRef[],
  ): Promise<Result<ReleaseVerificationReport, ReportRefusal>>;
  approveReport(
    reportDigest: string,
    approvalCommand: ApprovalCommand,
  ): Promise<Result<ReleaseApprovalRecord, ReportRefusal>>;
  readReport(reportIdOrDigest: string): Promise<ReadReportResult>;
  readApprovedRuntimePin(query: RuntimePinQuery): Promise<RuntimePinResult>;
  cleanupUnreadableReports(): Promise<readonly string[]>;
};

const inspectAssemblyControl = (
  typedEvidenceRefs: readonly TypedEvidenceRef[],
): ReportRefusal | null => {
  const found: string[] = [];
  collectForbiddenKeys(typedEvidenceRefs, found);
  if (found.length === 0) {
    return null;
  }
  if (found.some((key) => key.startsWith("waiv") || key.startsWith("skip"))) {
    return reportRefusal("waiver-forbidden", `assembly supplied ${found.join(",")}`);
  }
  return reportRefusal("gate-execution-forbidden", `assembly supplied ${found.join(",")}`);
};

const inspectEvidenceProfile = (
  planGateIds: ReadonlySet<string>,
  typedEvidenceRefs: readonly TypedEvidenceRef[],
): ReportRefusal | null => {
  for (const ref of typedEvidenceRefs) {
    if (!planGateIds.has(ref.gateId)) {
      return reportRefusal(
        "applicability-broadening-forbidden",
        `evidence names gate ${ref.gateId} outside the plan profile`,
      );
    }
  }
  return null;
};

export const createVerificationReportService = (options: {
  readonly db: Database;
  readonly clock?: RetentionClock;
}): VerificationReportService => {
  const clock = options.clock ?? systemRetentionClock();
  const core = createReleaseVerificationService({ db: options.db });

  const assembleReport = async (
    planDigest: string,
    typedEvidenceRefs: readonly TypedEvidenceRef[],
  ): Promise<Result<ReleaseVerificationReport, ReportRefusal>> => {
    const control = inspectAssemblyControl(typedEvidenceRefs);
    if (control) {
      return { ok: false, error: control };
    }
    const plan = await findPlanByDigest(options.db, planDigest);
    if (!plan) {
      return { ok: false, error: reportRefusal("plan-not-found", planDigest) };
    }
    const profileIds = new Set(plan.applicabilityProfile.map((entry) => entry.gateId));
    const extra = inspectEvidenceProfile(profileIds, typedEvidenceRefs);
    if (extra) {
      return { ok: false, error: extra };
    }
    const lineage = await inspectExactLineage(options.db, plan);
    if (!lineage.ok) {
      return lineage;
    }
    const assembled = await core.assembleReport(planDigest, typedEvidenceRefs);
    if (!assembled.ok) {
      return { ok: false, error: asReportRefusal(assembled.error) };
    }
    const report = assembled.value;
    if (digestOf(report.applicabilityProfile) !== digestOf(plan.applicabilityProfile)) {
      return {
        ok: false,
        error: reportRefusal(
          "applicability-broadening-forbidden",
          "assembled applicability must equal the plan profile",
        ),
      };
    }
    const expectedDigest = canonicalReportDigest(report);
    if (report.digest !== expectedDigest || !reportDigestIsDeterministic(report)) {
      return {
        ok: false,
        error: reportRefusal("nondeterministic-digest", "canonical report digest drifted"),
      };
    }
    return { ok: true, value: report };
  };

  const approveReport = async (
    reportDigest: string,
    approvalCommand: ApprovalCommand,
  ): Promise<Result<ReleaseApprovalRecord, ReportRefusal>> => {
    if (approvalCommand.principalKind === "verifier") {
      return {
        ok: false,
        error: reportRefusal("verifier-signature-is-not-approval", "verifier signatures cannot approve"),
      };
    }
    const stored = await findReport(options.db, reportDigest);
    if (stored.kind === "missing") {
      return { ok: false, error: reportRefusal("plan-not-found", reportDigest) };
    }
    if (approvalCommand.purpose !== stored.report.purpose) {
      return {
        ok: false,
        error: reportRefusal("wrong-purpose", "approval purpose must match the report"),
      };
    }
    const existing = await listApprovals(options.db, stored.report.digest);
    const reused = existing.find(
      (approval) =>
        approval.principalId === approvalCommand.principalId &&
        approval.principalKind !== approvalCommand.principalKind,
    );
    if (reused) {
      return {
        ok: false,
        error: reportRefusal("self-approval", "operator and platform-owner must differ"),
      };
    }
    const approved = await core.approveReport(reportDigest, approvalCommand);
    if (!approved.ok) {
      if (approved.error.kind === "distinct-principals-required") {
        return {
          ok: false,
          error: reportRefusal("self-approval", approved.error.detail),
        };
      }
      return { ok: false, error: asReportRefusal(approved.error) };
    }
    return { ok: true, value: approved.value };
  };

  const readReport = async (reportIdOrDigest: string): Promise<ReadReportResult> => {
    const result = await core.readReport(reportIdOrDigest);
    if (result.kind === "absent") {
      return result;
    }
    if (reportRetentionBlocksPresent(result.report, clock)) {
      return { kind: "absent", reason: "missing" };
    }
    if (!(await storedReportLineageIsExact(options.db, result.report))) {
      return { kind: "absent", reason: "unapproved" };
    }
    return result;
  };

  const cleanupUnreadableReports = async (): Promise<readonly string[]> => {
    const rows = await options.db.query<{ digest: string }>(
      "select digest from parameter_catalog.verification_reports",
    );
    const closed: string[] = [];
    for (const row of rows.rows) {
      const read = await readReport(row.digest);
      if (read.kind === "absent") {
        closed.push(row.digest);
      }
    }
    return closed;
  };

  return {
    assembleReport,
    approveReport,
    readReport,
    readApprovedRuntimePin: (query) => readApprovedRuntimePin(options.db, query, clock),
    cleanupUnreadableReports,
  };
};

export const createStartupRuntimePin = (options: {
  readonly db: Database;
  readonly clock?: RetentionClock;
}): StartupRuntimePinReader =>
  createStartupRuntimePinReader({
    db: options.db,
    clock: options.clock ?? systemRetentionClock(),
  });
