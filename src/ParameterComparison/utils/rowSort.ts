import type { ComparisonRow } from "../types";

const riskRank: Record<ComparisonRow["risk"], number> = {
  High: 0,
  Medium: 1,
  Low: 2
};

function getDeltaMagnitude(row: ComparisonRow) {
  if (row.baseNumeric === null || row.targetNumeric === null) {
    return -1;
  }
  if (row.baseNumeric === 0) {
    return Math.abs(row.targetNumeric - row.baseNumeric);
  }

  return Math.abs(((row.targetNumeric - row.baseNumeric) / Math.abs(row.baseNumeric)) * 100);
}

export function sortComparisonRows(rows: ComparisonRow[]) {
  return [...rows].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "drift" ? -1 : 1;
    }

    const riskDelta = riskRank[left.risk] - riskRank[right.risk];
    if (riskDelta !== 0) {
      return riskDelta;
    }

    const magnitudeDelta = getDeltaMagnitude(right) - getDeltaMagnitude(left);
    if (magnitudeDelta !== 0) {
      return magnitudeDelta;
    }

    return left.key.localeCompare(right.key);
  });
}
