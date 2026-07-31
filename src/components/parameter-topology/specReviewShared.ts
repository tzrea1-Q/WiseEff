import { PARAMETER_ADMIN_UI, type SpecReviewMatchStatusUi } from "@/application/parameters/parameterAdminUiCopy";
import { isSpecSelectableForReview } from "./ParameterSpecLibrary";

export type SpecReviewCandidate = {
  id: string;
  label: string;
  propertyKey?: string | null;
  driverModule?: string | null;
};

export type SpecReviewTaskView = {
  id: string;
  propertyKey: string;
  driverModule: string | null;
  projectCount: number;
  evidence: string[];
  candidates: SpecReviewCandidate[];
  ambiguous: boolean;
};

export type SpecReviewApproveInput = {
  taskId: string;
  parameterSpecId: string;
  reason: string;
  confirmPropertyMismatch?: boolean;
};

export type SpecReviewMatchStatus = SpecReviewMatchStatusUi;

/** Parse `nodename=…` from inference evidence lines. */
export function nodeNameFromEvidence(evidence: readonly string[]): string | null {
  for (const line of evidence) {
    const match = /nodename\s*=\s*([^\s,;|]+)/i.exec(line);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export function matchStatusLabel(task: Pick<SpecReviewTaskView, "candidates" | "ambiguous">): SpecReviewMatchStatus {
  if (task.candidates.length === 0) return PARAMETER_ADMIN_UI.matchUnmatched;
  if (task.ambiguous) return PARAMETER_ADMIN_UI.matchAmbiguous;
  return PARAMETER_ADMIN_UI.matchHasCandidates;
}

export function selectedSpec(
  task: SpecReviewTaskView,
  librarySpecs: readonly SpecReviewCandidate[],
  schemaId: string
): SpecReviewCandidate | undefined {
  return (
    task.candidates.find((candidate) => candidate.id === schemaId) ??
    librarySpecs.find((candidate) => candidate.id === schemaId)
  );
}

export function filterLibrarySpecsForReviewSelection<
  T extends { id: string; reviewState: string; organizationId?: string | null }
>(rows: readonly T[]): T[] {
  return rows.filter((row) =>
    isSpecSelectableForReview({
      reviewState: row.reviewState,
      organizationId: row.organizationId ?? null,
    })
  );
}
