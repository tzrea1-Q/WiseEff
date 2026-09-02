import type { AllowlistEntry, BoundaryViolation } from "./schema";
import { compareText } from "./schema";

export type BoundaryMetadataMismatch = {
  id: string;
  expected: Pick<AllowlistEntry, "rule" | "file" | "reason">;
  actual: Pick<BoundaryViolation, "rule" | "file" | "reason">;
};

export type BoundaryReport = {
  schemaVersion: 1;
  status: "passed" | "failed";
  summary: {
    violations: number;
    allowlisted: number;
    unallowlisted: number;
    staleAllowances: number;
    metadataMismatches: number;
    allowlistGrowth: number;
  };
  violations: BoundaryViolation[];
  unallowlisted: BoundaryViolation[];
  staleAllowances: AllowlistEntry[];
  metadataMismatches: BoundaryMetadataMismatch[];
  allowlistGrowth: AllowlistEntry[];
};

export function compareBoundaryInventory(
  discovered: readonly BoundaryViolation[],
  allowances: readonly AllowlistEntry[],
  initialBaseline?: readonly BoundaryViolation[],
): BoundaryReport {
  const violations = sortedUnique(discovered, "discovered violation");
  const sortedAllowances = sortedUnique(allowances, "allow-list entry");
  const violationsById = new Map(violations.map((violation) => [violation.id, violation]));
  const allowancesById = new Map(sortedAllowances.map((allowance) => [allowance.id, allowance]));
  const initialBaselineById = initialBaseline
    ? new Map(sortedUnique(initialBaseline, "initial baseline violation").map((violation) => [violation.id, violation]))
    : undefined;

  const unallowlisted = violations.filter((violation) => !allowancesById.has(violation.id));
  const staleAllowances = sortedAllowances.filter((allowance) => !violationsById.has(allowance.id));
  const metadataMismatches = violations.flatMap((violation): BoundaryMetadataMismatch[] => {
    const allowance = allowancesById.get(violation.id);
    if (
      !allowance ||
      (allowance.rule === violation.rule && allowance.file === violation.file && allowance.reason === violation.reason)
    ) {
      return [];
    }
    return [
      {
        id: violation.id,
        expected: { rule: allowance.rule, file: allowance.file, reason: allowance.reason },
        actual: { rule: violation.rule, file: violation.file, reason: violation.reason },
      },
    ];
  });
  const allowlistGrowth = initialBaselineById
    ? sortedAllowances.filter((allowance) => {
        const initial = initialBaselineById.get(allowance.id);
        return (
          !initial ||
          initial.rule !== allowance.rule ||
          initial.file !== allowance.file ||
          initial.reason !== allowance.reason
        );
      })
    : [];
  const status =
    unallowlisted.length === 0 &&
    staleAllowances.length === 0 &&
    metadataMismatches.length === 0 &&
    allowlistGrowth.length === 0
      ? "passed"
      : "failed";
  const allowlisted = violations.filter((violation) => {
    const allowance = allowancesById.get(violation.id);
    if (
      !allowance ||
      allowance.rule !== violation.rule ||
      allowance.file !== violation.file ||
      allowance.reason !== violation.reason
    ) {
      return false;
    }
    if (!initialBaselineById) return true;
    const initial = initialBaselineById.get(violation.id);
    return Boolean(
      initial &&
        initial.rule === allowance.rule &&
        initial.file === allowance.file &&
        initial.reason === allowance.reason,
    );
  }).length;

  return {
    schemaVersion: 1,
    status,
    summary: {
      violations: violations.length,
      allowlisted,
      unallowlisted: unallowlisted.length,
      staleAllowances: staleAllowances.length,
      metadataMismatches: metadataMismatches.length,
      allowlistGrowth: allowlistGrowth.length,
    },
    violations,
    unallowlisted,
    staleAllowances,
    metadataMismatches,
    allowlistGrowth,
  };
}

export function formatBoundaryReport(report: BoundaryReport) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function sortedUnique<Item extends { id: string }>(items: readonly Item[], label: string): Item[] {
  const sorted = [...items].sort((left, right) => compareText(left.id, right.id));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].id === sorted[index].id) {
      throw new Error(`Duplicate ${label} ID: ${sorted[index].id}.`);
    }
  }
  return sorted;
}
