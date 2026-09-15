/**
 * Archived old-link diagnostics for the parameter surface.
 *
 * The canonical Catalog answers a request for an archived legacy parameter id
 * with `410 GONE` plus a diagnostic, while the pre-cutover surface used a second
 * diagnostic name for the same outcome. `parameterClient` normalizes the two
 * into one archived result; this module turns that result into the notice the
 * parameter page renders, so an old link reports "archived" instead of quietly
 * falling back to whatever the current list happens to contain.
 *
 * The check is structural rather than `instanceof` so the domain layer does not
 * depend on the HTTP client, and so callers holding a plain error object can use
 * it directly.
 */

export const archivedLinkDiagnostics = [
  "legacy-id-archived",
  "legacy-parameter-id-retired"
] as const;

export type ArchivedLinkDiagnostic = (typeof archivedLinkDiagnostics)[number];

export type ArchivedParameterLinkNotice = {
  readonly parameterId: string;
  readonly diagnostic: ArchivedLinkDiagnostic;
  /** Identifier of the migration evidence, when the server supplies one. */
  readonly migrationEvidenceId: string | null;
};

const isArchivedLinkDiagnostic = (value: unknown): value is ArchivedLinkDiagnostic =>
  typeof value === "string" && (archivedLinkDiagnostics as readonly string[]).includes(value);

/**
 * Returns the archived notice for `parameterId` when `error` is an archived
 * old-link outcome, and `null` for every other error. `null` means "not known to
 * be archived" — callers must not render the notice on `null`.
 */
export function archivedParameterLinkNotice(
  parameterId: string,
  error: unknown
): ArchivedParameterLinkNotice | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  if (candidate.code !== "GONE") {
    return null;
  }
  const details =
    typeof candidate.details === "object" && candidate.details !== null
      ? (candidate.details as Record<string, unknown>)
      : {};
  const diagnostic = isArchivedLinkDiagnostic(details.diagnostic)
    ? details.diagnostic
    : isArchivedLinkDiagnostic(candidate.message)
      ? candidate.message
      : null;
  if (!diagnostic) {
    return null;
  }
  const evidence = details.migrationEvidenceId;
  return {
    parameterId,
    diagnostic,
    migrationEvidenceId: typeof evidence === "string" && evidence.length > 0 ? evidence : null
  };
}
