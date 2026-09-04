import type { VerificationRefusal } from "../core/errors";
import { verificationRefusalKinds } from "../core/errors";

export const reportRefusalKinds = [
  ...verificationRefusalKinds,
  "missing-predecessor-digest",
  "self-approval",
  "pre-pin",
  "nondeterministic-digest",
  "retention-closed",
  "gate-execution-forbidden",
  "applicability-broadening-forbidden",
] as const;

export type ReportRefusalKind = (typeof reportRefusalKinds)[number];

export type ReportRefusal = {
  readonly kind: ReportRefusalKind;
  readonly detail: string;
};

export const reportRefusal = (kind: ReportRefusalKind, detail: string): ReportRefusal => ({
  kind,
  detail,
});

export const asReportRefusal = (error: VerificationRefusal): ReportRefusal => error;
