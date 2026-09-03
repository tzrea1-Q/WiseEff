import pg from "pg";

import type { CatalogReleasePin } from "../../parameter-catalog-contract/index";

import type { RegistrationFailure } from "../registration/failures";
import { mapWriterDatabaseError } from "../registration/failures";

export type GovernanceFailure =
  | RegistrationFailure
  | {
      readonly kind: "review-item-not-found";
      readonly reviewItemId: string;
    }
  | {
      readonly kind: "revision-conflict";
      readonly reviewItemId: string;
      readonly storedEtag: string;
      readonly attemptedEtag: string;
    }
  | {
      readonly kind: "revision-conflict";
      readonly reviewItemId: string;
      readonly status: "resolved" | "out-of-scope";
    }
  | {
      readonly kind: "permission-denied";
      readonly actorKind:
        | "org-admin"
        | "org-member"
        | "platform-admin"
        | "trusted-system"
        | "agent"
        | "anonymous";
    };

export const mapRegistrationFailure = (
  error: RegistrationFailure,
): GovernanceFailure => error;

export const mapCoordinatorDatabaseError = (
  error: unknown,
  expected: CatalogReleasePin,
  subjectId: string,
): GovernanceFailure | null => {
  const mapped = mapWriterDatabaseError(error, expected, subjectId);
  if (mapped) return mapped;
  if (!(error instanceof pg.DatabaseError)) return null;
  if (error.code === "23505") {
    return {
      kind: "revision-conflict",
      idempotencyKey: subjectId,
      storedFingerprint: error.constraint ?? "unique-violation",
      attemptedFingerprint: subjectId,
    };
  }
  if (error.code === "23503") {
    return { kind: "invalid-command", reason: "foreign-key" };
  }
  return null;
};
