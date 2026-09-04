import type { Result, VerificationPurpose } from "../../parameter-catalog-contract/index";
import { digestOf } from "../core/digest";
import { findReport, listApprovals } from "../core/persistence";
import type { Database } from "../../../shared/database/client";
import type {
  ReleaseApprovalRecord,
  ReleaseVerificationReport,
  VerificationPlan,
} from "../core/types";
import { reportRefusal, type ReportRefusal } from "./errors";

export const PUBLIC_RELEASE_PREDECESSOR_PURPOSES = [
  "pre-activation",
  "post-retirement-runtime",
  "isolated-candidate-acceptance",
] as const satisfies readonly VerificationPurpose[];

const PURPOSES_REQUIRING_APPROVAL: ReadonlySet<VerificationPurpose> = new Set([
  "pre-activation",
  "post-retirement-runtime",
  "public-release",
  "legacy-read-sunset",
  "p16-cleanup",
]);

export const requiredPredecessorPurposes = (
  purpose: VerificationPurpose,
): readonly VerificationPurpose[] => {
  switch (purpose) {
    case "public-release":
      return PUBLIC_RELEASE_PREDECESSOR_PURPOSES;
    case "legacy-read-sunset":
      return ["public-release"];
    case "p16-cleanup":
      return ["public-release", "legacy-read-sunset"];
    case "pre-activation":
    case "post-retirement-runtime":
    case "isolated-candidate-acceptance":
      return [];
  }
};

export const allowedPredecessorPurposes = (
  purpose: VerificationPurpose,
): readonly VerificationPurpose[] => {
  switch (purpose) {
    case "pre-activation":
      return [];
    case "post-retirement-runtime":
      return ["pre-activation"];
    case "isolated-candidate-acceptance":
      return ["post-retirement-runtime"];
    case "public-release":
      return PUBLIC_RELEASE_PREDECESSOR_PURPOSES;
    case "legacy-read-sunset":
      return ["public-release"];
    case "p16-cleanup":
      return ["public-release", "legacy-read-sunset"];
  }
};

export const reportAuthorizesPurpose = (
  report: Pick<ReleaseVerificationReport, "purpose" | "decision">,
  purpose: VerificationPurpose,
): boolean => report.purpose === purpose && report.decision === "passed";

export const approvalsComplete = (
  purpose: VerificationPurpose,
  approvals: readonly ReleaseApprovalRecord[],
): boolean => {
  if (!PURPOSES_REQUIRING_APPROVAL.has(purpose)) {
    return true;
  }
  const kinds = new Set(approvals.map((approval) => approval.principalKind));
  return kinds.has("operator") && kinds.has("platform-owner");
};

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;

export const inspectExactLineage = async (
  db: Database,
  plan: VerificationPlan,
): Promise<Result<readonly ReleaseVerificationReport[], ReportRefusal>> => {
  const required = requiredPredecessorPurposes(plan.purpose);
  const allowed = new Set(allowedPredecessorPurposes(plan.purpose));
  const digests = plan.lineage.predecessorReportDigests;

  if (!unique(digests)) {
    return {
      ok: false,
      error: reportRefusal("wrong-purpose", "predecessor digests must be unique exact bindings"),
    };
  }

  if (required.length > 0 && digests.length !== required.length) {
    return {
      ok: false,
      error: reportRefusal(
        "missing-predecessor-digest",
        `${plan.purpose} requires exact predecessor digests: ${required.join(",")}`,
      ),
    };
  }

  if (required.length === 0 && allowed.size === 0 && digests.length > 0) {
    return {
      ok: false,
      error: reportRefusal(
        "wrong-purpose",
        `${plan.purpose} cannot bind a predecessor that would authorize a different purpose`,
      ),
    };
  }

  const predecessors: ReleaseVerificationReport[] = [];
  for (const digest of digests) {
    if (!digest || digest.trim().length === 0) {
      return {
        ok: false,
        error: reportRefusal("missing-predecessor-digest", "predecessor digest is empty"),
      };
    }
    const stored = await findReport(db, digest);
    if (stored.kind === "missing") {
      return {
        ok: false,
        error: reportRefusal("missing-predecessor-digest", digest),
      };
    }
    const predecessor = stored.report;
    if (predecessor.purpose === plan.purpose) {
      return {
        ok: false,
        error: reportRefusal("wrong-purpose", "a report cannot authorize a different purpose"),
      };
    }
    if (!allowed.has(predecessor.purpose)) {
      return {
        ok: false,
        error: reportRefusal(
          "wrong-purpose",
          `predecessor purpose ${predecessor.purpose} cannot authorize ${plan.purpose}`,
        ),
      };
    }
    if (!reportAuthorizesPurpose(predecessor, predecessor.purpose)) {
      return {
        ok: false,
        error: reportRefusal(
          "wrong-purpose",
          `predecessor ${predecessor.digest} is not a passing ${predecessor.purpose} report`,
        ),
      };
    }
    if (digestOf(predecessor.pins) !== digestOf(plan.pins)) {
      return {
        ok: false,
        error: reportRefusal("evidence-pin-mismatch", "predecessor pins must equal the assembling plan"),
      };
    }
    const approvals = await listApprovals(db, predecessor.digest);
    if (!approvalsComplete(predecessor.purpose, approvals)) {
      return {
        ok: false,
        error: reportRefusal(
          "wrong-purpose",
          `predecessor ${predecessor.digest} is not an approved ${predecessor.purpose} report`,
        ),
      };
    }
    predecessors.push(predecessor);
  }

  if (required.length > 0) {
    const found = new Set(predecessors.map((report) => report.purpose));
    for (const purpose of required) {
      if (!found.has(purpose)) {
        return {
          ok: false,
          error: reportRefusal(
            "wrong-purpose",
            `public-release predecessor purposes must be exactly ${required.join(",")}`,
          ),
        };
      }
    }
  }

  return { ok: true, value: predecessors };
};

export const storedReportLineageIsExact = async (
  db: Database,
  report: ReleaseVerificationReport,
): Promise<boolean> => {
  const required = requiredPredecessorPurposes(report.purpose);
  if (required.length === 0) {
    return true;
  }
  const fakePlan = {
    purpose: report.purpose,
    pins: report.pins,
    lineage: { predecessorReportDigests: report.predecessorReportDigests },
  } as VerificationPlan;
  const inspected = await inspectExactLineage(db, fakePlan);
  return inspected.ok;
};
