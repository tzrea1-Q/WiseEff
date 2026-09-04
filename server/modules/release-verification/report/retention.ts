import type { VerificationPurpose } from "../../parameter-catalog-contract/index";
import type { ReleaseVerificationReport, RetentionDeadlineInputs } from "../core/types";

export type RetentionClock = {
  now(): Date;
};

export const systemRetentionClock = (): RetentionClock => ({
  now: () => new Date(),
});

export type RetentionEvaluation =
  | { readonly status: "retained" }
  | { readonly status: "expired"; readonly deadline: string }
  | { readonly status: "unbound"; readonly missing: readonly string[] };

const ISO_BOUND = /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/;

const isBound = (value: string | null): value is string =>
  typeof value === "string" && value.trim().length > 0;

const parseDatedBound = (value: string | null): Date | null => {
  if (!isBound(value) || !ISO_BOUND.test(value)) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const plusOneYear = (value: Date): Date => {
  const next = new Date(value.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
};

const requiredCleanupBounds = (purpose: VerificationPurpose): readonly string[] => {
  if (purpose === "p16-cleanup") {
    return ["cleanupReleaseAcceptanceBound"];
  }
  return [];
};

export const evaluateRetention = (
  inputs: RetentionDeadlineInputs,
  purpose: VerificationPurpose,
  clock: RetentionClock,
): RetentionEvaluation => {
  const missing = requiredCleanupBounds(purpose).filter((field) => {
    if (field === "cleanupReleaseAcceptanceBound") {
      return !isBound(inputs.cleanupReleaseAcceptanceBound);
    }
    return false;
  });
  if (missing.length > 0) {
    return { status: "unbound", missing };
  }

  const deadlines: Date[] = [];
  const cleanupAccepted = parseDatedBound(inputs.cleanupReleaseAcceptanceBound);
  if (cleanupAccepted) {
    deadlines.push(plusOneYear(cleanupAccepted));
  }
  const restoreBound = parseDatedBound(inputs.lastSupportedRestoreOrCompatibilityBound);
  if (restoreBound) {
    deadlines.push(plusOneYear(restoreBound));
  }
  const publicWindow = parseDatedBound(inputs.publicLegacyReadWindowBound);
  if (publicWindow) {
    deadlines.push(publicWindow);
  }
  if (deadlines.length === 0) {
    return { status: "retained" };
  }
  const latest = deadlines.reduce((current, next) => (next > current ? next : current));
  if (clock.now().getTime() > latest.getTime()) {
    return { status: "expired", deadline: latest.toISOString() };
  }
  return { status: "retained" };
};

export const reportRetentionBlocksPresent = (
  report: ReleaseVerificationReport,
  clock: RetentionClock,
): boolean => evaluateRetention(report.retentionDeadlineInputs, report.purpose, clock).status !== "retained";
