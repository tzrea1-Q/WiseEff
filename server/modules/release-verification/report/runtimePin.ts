import { digestOf } from "../core/digest";
import { findPlanByDigest, findReport, listApprovals } from "../core/persistence";
import type { Database } from "../../../shared/database/client";
import type {
  ReleaseVerificationReport,
  VerificationPins,
  VerificationSubject,
} from "../core/types";
import { approvalsComplete } from "./lineage";
import { reportRetentionBlocksPresent, type RetentionClock } from "./retention";

export const P13_RETIRED_STATE = "retired";

export type RuntimePinQuery = {
  readonly p13State: string;
  readonly writerRetirementFingerprint: string | null;
  readonly runtimePinGeneration: string | null;
  readonly pins: VerificationPins;
  readonly subject: VerificationSubject;
};

export type RuntimePinAbsenceReason = "pre-pin" | "missing" | "unapproved";

export type RuntimePinResult =
  | { readonly kind: "present"; readonly report: ReleaseVerificationReport }
  | { readonly kind: "absent"; readonly reason: RuntimePinAbsenceReason };

export type StartupRuntimePinReader = {
  readApprovedRuntimePin(query: RuntimePinQuery): Promise<RuntimePinResult>;
};

type RuntimePinRow = {
  digest: string;
};

const isRetiredP13 = (query: RuntimePinQuery): boolean =>
  query.p13State === P13_RETIRED_STATE &&
  typeof query.writerRetirementFingerprint === "string" &&
  query.writerRetirementFingerprint.trim().length > 0;

export const readApprovedRuntimePin = async (
  db: Database,
  query: RuntimePinQuery,
  clock: RetentionClock,
): Promise<RuntimePinResult> => {
  if (!isRetiredP13(query)) {
    return { kind: "absent", reason: "pre-pin" };
  }

  const rows = await db.query<RuntimePinRow>(
    `select r.digest
     from parameter_catalog.verification_reports r
     inner join parameter_catalog.verification_plans p on p.digest = r.plan_digest
     where r.purpose = 'post-retirement-runtime'
       and r.decision = 'passed'
     order by r.assembled_at desc, r.id desc`,
  );

  for (const row of rows.rows) {
    const stored = await findReport(db, row.digest);
    if (stored.kind === "missing") {
      continue;
    }
    const plan = await findPlanByDigest(db, stored.report.planDigest);
    if (!plan) {
      continue;
    }
    if (plan.lineage.p13State !== query.p13State) {
      continue;
    }
    if (plan.lineage.writerRetirementFingerprint !== query.writerRetirementFingerprint) {
      continue;
    }
    if (plan.lineage.runtimePinGeneration !== query.runtimePinGeneration) {
      continue;
    }
    if (digestOf(stored.report.pins) !== digestOf(query.pins)) {
      continue;
    }
    if (digestOf(plan.subject) !== digestOf(query.subject)) {
      continue;
    }
    const approvals = await listApprovals(db, stored.report.digest);
    if (!approvalsComplete(stored.report.purpose, approvals)) {
      return { kind: "absent", reason: "unapproved" };
    }
    if (reportRetentionBlocksPresent(stored.report, clock)) {
      continue;
    }
    return { kind: "present", report: stored.report };
  }

  return { kind: "absent", reason: "missing" };
};

export const createStartupRuntimePinReader = (options: {
  readonly db: Database;
  readonly clock: RetentionClock;
}): StartupRuntimePinReader => ({
  readApprovedRuntimePin: (query) => readApprovedRuntimePin(options.db, query, options.clock),
});
