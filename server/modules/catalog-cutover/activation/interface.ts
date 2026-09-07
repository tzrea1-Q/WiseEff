import type pg from "pg";
import type { Database } from "../../../shared/database/client";
import type { VerificationPins, VerificationSubject } from "../../release-verification/core/types";

export type ActivationIdentity = Readonly<{ systemIdentifier: string; databaseOid: string }>;
export type ActivationIntent = Readonly<{
  runId: string;
  attemptId: string;
  target: ActivationIdentity;
  planDigest: string;
  predecessorBindingDigest: string | null;
  reportDigest: string;
  expectedObservationDigest: string;
  inputDigest: string;
}>;

export type ActivationBinding = Readonly<{
  version: "pcat-activation-v1";
  intent: ActivationIntent;
  mode: "canonical";
  sourceSnapshotFingerprint: string;
  catalog: Readonly<{
    releaseId: string; releaseDigest: string;
    compiledFingerprint: string; databaseFingerprint: string;
  }>;
  mapping: Readonly<{ epoch: string; headDigest: string }>;
  comparisonReportDigest: string;
  bindingDigest: string;
}>;

export type ActivationInspection =
  | { readonly kind: "applied"; readonly binding: ActivationBinding; readonly currentHeadDigest: string }
  | { readonly kind: "not-applied"; readonly intent: ActivationIntent; readonly currentHeadDigest: string | null };

/** Produced by the owning controller under its actual writer/traffic fence.
 * The domain checks these facts against PostgreSQL; it never fills them from a
 * report, environment flag or the checkpoint that is about to be written. */
export type ActivationObservation = Readonly<{
  pins: VerificationPins;
  subject: VerificationSubject;
  phaseSnapshot: string;
  predecessorReportDigests: readonly string[];
  pointerRollbackStatus: "open" | "closed";
  trafficIsolationState: "isolated" | "public";
  initialReadMode: "legacy" | "canonical";
  comparisonReportDigest: string;
}>;

/** Adapter over the existing append-only host journal. Implementations must
 * prove durable pending before SQL and reconcile from the domain inspection;
 * a caller-supplied boolean is not a journal implementation. */
export type ActivationJournal = {
  pending(intent: ActivationIntent): Promise<void>;
  committed(binding: ActivationBinding): Promise<void>;
  unknown(intent: ActivationIntent): Promise<void>;
};

export type ActivationOptions = {
  readonly managementPool: pg.Pool;
  readonly reports: Database;
  readonly target: ActivationIdentity;
  readonly boundary: {
    withLockedBoundary<T>(body: () => Promise<T>): Promise<T>;
    verify(): Promise<void>;
    observe(): Promise<ActivationObservation>;
  };
  readonly journal: ActivationJournal;
};

export class ActivationRefusal extends Error {
  constructor(readonly reason: string) { super(`PCAT-ACTIVATION-${reason}`); this.name = "ActivationRefusal"; }
}
