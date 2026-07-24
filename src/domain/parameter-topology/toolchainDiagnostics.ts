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
