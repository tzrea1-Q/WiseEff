import type { DtsReloadRunPurpose, DtsReloadRunStatus } from "./types";

export type DtsReloadPromotionRejection =
  | {
      allowed: false;
      reason: "restore-baseline";
      details: {
        code: "reload-promote-ineligible";
        purpose: "restore-baseline";
        status: DtsReloadRunStatus;
      };
    }
  | {
      allowed: false;
      reason: "unverifiable-ack-required";
      details: {
        code: "reload-promote-unverifiable-ack-required";
        status: "unverifiable";
      };
    }
  | {
      allowed: false;
      reason: "status-ineligible";
      details: {
        code: "reload-promote-ineligible";
        purpose: "ordinary";
        status: Exclude<DtsReloadRunStatus, "verified" | "unverifiable">;
      };
    };

export type DtsReloadPromotionEligibility =
  | { allowed: true }
  | DtsReloadPromotionRejection;

export function evaluateDtsReloadPromotionEligibility(input: {
  status: DtsReloadRunStatus;
  purpose: DtsReloadRunPurpose;
  unverifiableAcknowledged?: boolean;
}): DtsReloadPromotionEligibility {
  if (input.purpose === "restore-baseline") {
    return {
      allowed: false,
      reason: "restore-baseline",
      details: {
        code: "reload-promote-ineligible",
        purpose: input.purpose,
        status: input.status
      }
    };
  }

  if (input.status === "verified") {
    return { allowed: true };
  }

  if (input.status === "unverifiable") {
    return input.unverifiableAcknowledged === true
      ? { allowed: true }
      : {
          allowed: false,
          reason: "unverifiable-ack-required",
          details: {
            code: "reload-promote-unverifiable-ack-required",
            status: input.status
          }
        };
  }

  return {
    allowed: false,
    reason: "status-ineligible",
    details: {
      code: "reload-promote-ineligible",
      purpose: input.purpose,
      status: input.status
    }
  };
}
