const TOOLCHAIN_NOISE_CODES = new Set([
  "compile-failed",
  "schema-failed",
  "toolchain-unavailable",
  "version-mismatch",
  "ranges_format",
  "reg_format",
  "unit_address_vs_reg",
  "dtc",
  "fdtoverlay",
  "dt-validate",
  "toolchain"
]);

const PRODUCT_DIAGNOSTIC_CODES = new Set([
  "TOPOLOGY_NOT_READY",
  "BINDING_NOT_FOUND",
  "PROJECT_CHANGED",
  "unresolved-mapping",
  "resolve-failure",
  "schema-blocked",
  "needs-mapping"
]);

const TOOLCHAIN_NOISE_MESSAGE_PATTERNS = [
  /ranges_format/i,
  /reg_format/i,
  /unit_address_vs_reg/i,
  /#address-cells/i,
  /address-cells.*(?:does not match|differs)/i,
  /empty\s+ranges/i,
  /ranges\s+property.*empty/i,
  /Warning\s*\([^)]+\)/i,
  /\bdtc\b/i,
  /\bfdtoverlay\b/i,
  /\bdt-validate\b/i,
  /\bdtschema\b/i,
  /\btoolchain\b/i,
  /\bstage:\s*(dtc|fdtoverlay|dt-validate|toolchain)\b/i
];

/**
 * Returns true when a diagnostic is dtc/fdtoverlay compile noise that should not
 * appear on the default parameter workbench governance surface.
 */
export function isToolchainCompileNoise(diagnostic: {
  code?: string;
  message: string;
  severity?: string;
}): boolean {
  const code = diagnostic.code?.trim() ?? "";
  const message = diagnostic.message.trim();
  if (!message) {
    return false;
  }

  if (code && PRODUCT_DIAGNOSTIC_CODES.has(code)) {
    return false;
  }

  if (code && TOOLCHAIN_NOISE_CODES.has(code)) {
    return true;
  }

  return TOOLCHAIN_NOISE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

export function filterProductWorkbenchDiagnostics<
  T extends { code?: string; message: string; severity?: string }
>(diagnostics: T[]): T[] {
  return diagnostics.filter((item) => !isToolchainCompileNoise(item));
}

const DANGLING_REFERENCE_CODE = "dangling-reference";
const DANGLING_REFERENCE_MESSAGE_RE =
  /Overlay target\s+"&([^"]+)"\s+is not defined in the uploaded file set/i;

/** True when a diagnostic is a self-anchored dangling `&label` overlay warning. */
export function isDanglingReferenceDiagnostic(diagnostic: {
  code?: string;
  message: string;
}): boolean {
  const code = diagnostic.code?.trim() ?? "";
  if (code === DANGLING_REFERENCE_CODE) return true;
  return DANGLING_REFERENCE_MESSAGE_RE.test(diagnostic.message);
}

/** Extract the missing overlay label from a dangling-reference diagnostic, if present. */
export function danglingReferenceLabel(diagnostic: { message: string }): string | null {
  const match = diagnostic.message.match(/Overlay target\s+"&([^"]+)"/i);
  return match?.[1] ?? null;
}

export type DanglingReferenceSummary = {
  count: number;
  labels: string[];
  /** Highest-severity among the group; dangling refs are normally `"warning"`. */
  severity: string;
};

/**
 * Collapse self-anchored overlay diagnostics into one summary for the workbench
 * governance surface. Other diagnostics are returned unchanged for flat listing.
 */
export function partitionDanglingReferenceDiagnostics<
  T extends { code?: string; message: string; severity?: string }
>(diagnostics: readonly T[]): {
  dangling: T[];
  other: T[];
  summary: DanglingReferenceSummary | null;
} {
  const dangling: T[] = [];
  const other: T[] = [];
  for (const item of diagnostics) {
    if (isDanglingReferenceDiagnostic(item)) {
      dangling.push(item);
    } else {
      other.push(item);
    }
  }

  if (dangling.length === 0) {
    return { dangling, other, summary: null };
  }

  const labels: string[] = [];
  const seen = new Set<string>();
  let severity = "warning";
  for (const item of dangling) {
    if (item.severity === "error") severity = "error";
    else if (severity !== "error" && item.severity) severity = item.severity;
    const label = danglingReferenceLabel(item);
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }

  return {
    dangling,
    other,
    summary: {
      count: dangling.length,
      labels,
      severity
    }
  };
}

/** One-line Chinese summary for the collapsed dangling-reference group. */
export function formatDanglingReferenceSummary(summary: DanglingReferenceSummary): string {
  const count = summary.labels.length > 0 ? summary.labels.length : summary.count;
  return `${count} 个悬空 overlay 引用已自锚定，参数仍可管理`;
}
