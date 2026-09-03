export const verificationRefusalKinds = [
  "unknown-purpose",
  "unknown-mode",
  "caller-gate-selection-forbidden",
  "waiver-forbidden",
  "plan-not-found",
  "incomplete-attempt",
  "half-report-forbidden",
  "evidence-pin-mismatch",
  "wrong-principal",
  "wrong-purpose",
  "verifier-signature-is-not-approval",
  "distinct-principals-required",
  "report-not-passed",
  "approval-not-applicable",
  "append-only-conflict",
  "concurrent-conflict",
] as const;

export type VerificationRefusalKind = (typeof verificationRefusalKinds)[number];

export type VerificationRefusal = {
  readonly kind: VerificationRefusalKind;
  readonly detail: string;
};

export const refusal = (
  kind: VerificationRefusalKind,
  detail: string,
): VerificationRefusal => ({ kind, detail });
