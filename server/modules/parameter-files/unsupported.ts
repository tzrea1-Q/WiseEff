/**
 * Hard-unsupported DTS constructs outside the structured parser / config-set
 * resolver contract. `/include/` is intentionally not reported here: missing
 * or cyclic includes are `resolveDtsConfigSet` diagnostics, not upload blockers.
 *
 * The `"include"` code remains in the public type for API schema compatibility
 * with historical `unsupportedConstructs` payloads; the detector never emits it.
 */
export type UnsupportedConstructCode = "include";

export type UnsupportedConstruct = {
  code: UnsupportedConstructCode;
  message: string;
  sample: string;
};

/** Detect DTS constructs that remain hard-unsupported (none after config-set include resolution). */
export function detectUnsupportedDtsConstructs(_source: string): UnsupportedConstruct[] {
  return [];
}
