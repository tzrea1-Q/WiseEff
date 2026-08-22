import { describe, expect, it } from "vitest";

import { evaluateDtsReloadPromotionEligibility } from "./promotionGuard";
import type { DtsReloadRunPurpose, DtsReloadRunStatus } from "./types";

describe("evaluateDtsReloadPromotionEligibility", () => {
  it.each([
    {
      name: "allows an ordinary verified run",
      status: "verified",
      purpose: "ordinary",
      acknowledged: undefined,
      expected: { allowed: true }
    },
    {
      name: "refuses a verified restore-baseline run",
      status: "verified",
      purpose: "restore-baseline",
      acknowledged: undefined,
      expected: {
        allowed: false,
        reason: "restore-baseline",
        details: {
          code: "reload-promote-ineligible",
          purpose: "restore-baseline",
          status: "verified"
        }
      }
    },
    {
      name: "refuses an acknowledged unverifiable restore-baseline run",
      status: "unverifiable",
      purpose: "restore-baseline",
      acknowledged: true,
      expected: {
        allowed: false,
        reason: "restore-baseline",
        details: {
          code: "reload-promote-ineligible",
          purpose: "restore-baseline",
          status: "unverifiable"
        }
      }
    },
    {
      name: "requires acknowledgement for an ordinary unverifiable run",
      status: "unverifiable",
      purpose: "ordinary",
      acknowledged: undefined,
      expected: {
        allowed: false,
        reason: "unverifiable-ack-required",
        details: {
          code: "reload-promote-unverifiable-ack-required",
          status: "unverifiable"
        }
      }
    },
    {
      name: "requires an explicit true acknowledgement for an ordinary unverifiable run",
      status: "unverifiable",
      purpose: "ordinary",
      acknowledged: false,
      expected: {
        allowed: false,
        reason: "unverifiable-ack-required",
        details: {
          code: "reload-promote-unverifiable-ack-required",
          status: "unverifiable"
        }
      }
    },
    {
      name: "allows an acknowledged ordinary unverifiable run",
      status: "unverifiable",
      purpose: "ordinary",
      acknowledged: true,
      expected: { allowed: true }
    }
  ] satisfies Array<{
    name: string;
    status: DtsReloadRunStatus;
    purpose: DtsReloadRunPurpose;
    acknowledged: boolean | undefined;
    expected: unknown;
  }>)("$name", ({ status, purpose, acknowledged, expected }) => {
    expect(
      evaluateDtsReloadPromotionEligibility({
        status,
        purpose,
        unverifiableAcknowledged: acknowledged
      })
    ).toEqual(expected);
  });

  it.each([
    "pending",
    "blocked",
    "validated",
    "deploying",
    "contradicted",
    "failed"
  ] satisfies DtsReloadRunStatus[])("refuses an ordinary %s run", (status) => {
    expect(
      evaluateDtsReloadPromotionEligibility({
        status,
        purpose: "ordinary"
      })
    ).toEqual({
      allowed: false,
      reason: "status-ineligible",
      details: {
        code: "reload-promote-ineligible",
        purpose: "ordinary",
        status
      }
    });
  });
});
