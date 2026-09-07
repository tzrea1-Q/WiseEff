import type pg from "pg";
import type { Database } from "../../../shared/database/client";
import type { ReleaseVerificationReport } from "../../release-verification/core";
import type { RuntimePinQuery } from "../../release-verification/report";
import type { BindingDatabaseIdentity } from "../../parameter-bindings/cutoverImport/sourceBoundary";
import type { RuntimeObservationBoundary } from "../runtimeState";
import type { ActivationFacts } from "./facts";

export type ActivationBoundary = RuntimePinQuery & {
  readonly phaseSnapshot: string;
  readonly p12State: "not-started" | "completed";
  readonly trafficIsolationState: "isolated" | "public";
  readonly predecessorReportDigests: readonly string[];
  readonly pointerRollbackStatus: "open" | "closed";
};

/** The parent target owner supplies actual artifact/storage/isolation observations.
 * No default producer exists and this port is not populated from report pins.
 */
export type ActivationTargetOwner = RuntimeObservationBoundary & {
  observeBoundary(facts: ActivationFacts, mappingEpoch: string): Promise<ActivationBoundary>;
};

export type ActivationOptions = {
  readonly managementPool: pg.Pool;
  /** Private configuration consumed only by the component-owned reader pool. */
  readonly catalogReadConnectionString: string;
  readonly reportDatabase: Database;
  readonly target: BindingDatabaseIdentity;
  readonly runId: string;
  readonly expectedMigrations: readonly { name: string; checksum: string }[];
  readonly owner: ActivationTargetOwner;
};

export type ActivationInspection = {
  readonly facts: ActivationFacts;
  readonly mode: "legacy" | "canonical";
  readonly generation: string;
  readonly attemptId: string | null;
  readonly binding: Readonly<Record<string, unknown>> | null;
  readonly mappingEpoch: string;
  readonly epochPrepared: boolean;
  readonly factsDigest: string;
  readonly attempts: readonly { id: string; state: string; request_digest: string; refusal_code: string | null }[];
};

export type ActivationAttemptInspection = {
  readonly outcome: "missing" | "pending" | "applied" | "inconsistent";
  readonly attemptId: string;
  readonly requestDigest: string | null;
  readonly pointerGeneration: string;
  readonly pointerMode: "legacy" | "canonical";
};

/** Structurally installs into the existing runCatalogReleaseAction target port.
 * This owner implements only P12; later effects must be separately installed.
 */
export type P12ActivationTarget = {
  withExclusiveBoundary<T>(body: () => Promise<T>): Promise<T>;
  observeBoundary(): Promise<ActivationBoundary>;
  activateP12(report: ReleaseVerificationReport): Promise<void>;
  startCandidate(report: ReleaseVerificationReport): Promise<never>;
  releasePublic(report: ReleaseVerificationReport): Promise<never>;
};

export class ActivationRefusal extends Error {
  constructor(readonly reason: string) { super(`p12-${reason}`); }
}
