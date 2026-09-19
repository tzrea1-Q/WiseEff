import { describe, expect, it } from "vitest";

import {
  assertCutoverIdentities,
  assertIdentitiesMatch,
  fixtureCutoverIdentities,
} from "./identities";

describe("cutover identity pin", () => {
  it("refuses incomplete inventory and drifted observations", () => {
    const pin = fixtureCutoverIdentities();
    expect(assertCutoverIdentities(pin).ok).toBe(true);
    expect(assertCutoverIdentities({ ...pin, seedDigest: "not-a-digest" }).ok).toBe(false);
    expect(assertCutoverIdentities({ ...pin, archiveDigest: undefined }).ok).toBe(false);
    const drifted = assertIdentitiesMatch(pin, {
      ...pin,
      imageDigest: fixtureCutoverIdentities("other").imageDigest,
    });
    expect(drifted.ok).toBe(false);
    if (drifted.ok) return;
    expect(drifted.error.detail).toMatch(/imageDigest/);
    expect(assertIdentitiesMatch(pin, pin).ok).toBe(true);
  });
});
