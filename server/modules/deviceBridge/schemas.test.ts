import { describe, expect, it } from "vitest";

import {
  issuePairingCodeResponseSchema,
  pairWithCodeBodySchema,
  pairWithCodeResponseSchema
} from "./schemas";

describe("device bridge schemas", () => {
  it("accepts valid pair-with-code request bodies", () => {
    const result = pairWithCodeBodySchema.safeParse({
      code: "123456",
      machineLabel: "WIN-PC",
      platform: "windows",
      arch: "amd64",
      clientVersion: "0.1.0"
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid pairing codes and empty machine labels", () => {
    expect(
      pairWithCodeBodySchema.safeParse({
        code: "12345",
        machineLabel: "WIN-PC",
        platform: "windows",
        arch: "amd64"
      }).success
    ).toBe(false);
    expect(
      pairWithCodeBodySchema.safeParse({
        code: "123456",
        machineLabel: "",
        platform: "windows",
        arch: "amd64"
      }).success
    ).toBe(false);
  });

  it("accepts issue and pair response shapes", () => {
    expect(
      issuePairingCodeResponseSchema.safeParse({
        code: "654321",
        expiresAt: "2026-06-23T00:05:00.000Z"
      }).success
    ).toBe(true);
    expect(
      pairWithCodeResponseSchema.safeParse({
        bridgeId: "br_abc",
        bridgeToken: "wb_secret",
        tokenExpiresAt: "2026-09-21T00:00:00.000Z"
      }).success
    ).toBe(true);
  });

  it("rejects bridge tokens without wb_ prefix in responses", () => {
    expect(
      pairWithCodeResponseSchema.safeParse({
        bridgeId: "br_abc",
        bridgeToken: "secret",
        tokenExpiresAt: "2026-09-21T00:00:00.000Z"
      }).success
    ).toBe(false);
  });
});
