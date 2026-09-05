import pg from "pg";

import type { CatalogReleasePin } from "../../parameter-catalog-contract/index";

import type { ProposalTrustedContext } from "./command";

export type ProposalFailure =
  | {
      readonly kind: "proposal-stale";
      readonly capturedRelease: CatalogReleasePin;
      readonly currentRelease: CatalogReleasePin;
    }
  | {
      readonly kind: "proposal-self-approval-forbidden";
      readonly authorPrincipalId: string;
      readonly reviewerPrincipalId: string;
    }
  | {
      readonly kind: "permission-denied";
      readonly actorKind: ProposalTrustedContext["actorKind"];
      readonly method: string;
    }
  | {
      readonly kind: "revision-conflict";
      readonly idempotencyKey: string;
      readonly storedFingerprint: string;
      readonly attemptedFingerprint: string;
    }
  | {
      readonly kind: "invalid-command";
      readonly reason: string;
    }
  | {
      readonly kind: "proposal-not-found";
      readonly proposalId: string;
    }
  | {
      readonly kind: "invalid-transition";
      readonly from: string;
      readonly attempted: string;
    };

export const mapWriterDatabaseError = (error: unknown): ProposalFailure | null => {
  if (!(error instanceof pg.DatabaseError)) return null;
  if (error.code === "23503") {
    return { kind: "invalid-command", reason: "foreign-key" };
  }
  if (error.code === "23505") {
    return {
      kind: "revision-conflict",
      idempotencyKey: "unique-violation",
      storedFingerprint: error.constraint ?? "unique-violation",
      attemptedFingerprint: "unique-violation",
    };
  }
  if (error.code === "PCA05" || error.code === "55P03") {
    return { kind: "invalid-command", reason: "synchronization-busy" };
  }
  return null;
};
