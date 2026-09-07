import { expect, it, vi } from "vitest";
import { inspectLegacyApplicationLoginFence, retireLegacyApplicationLogins, type LegacyLoginRetirementInput } from "./legacyWriterRetirement";
import { canonicalJson, sha256Prefixed } from "./journal";

function input() {
  const body = { format: "wiseeff-fixed-entry-handoff-v1", inputs: { lockRoot: "/private/unissued-lock" } };
  const handoff = { ...body, digest: sha256Prefixed(canonicalJson(body)) };
  const assertHeld = vi.fn(async () => undefined);
  return { value: { handoff, expectedHandoffDigest: handoff.digest, attemptId: "retire-attempt", lock: { assertHeld } } as unknown as LegacyLoginRetirementInput, assertHeld };
}
it.each(["", "../other", "bad attempt", "x".repeat(161)])("rejects malformed attempt %s before target calls", attemptId => {
  const fixture = input();
  return expect(retireLegacyApplicationLogins({ ...fixture.value, attemptId })).rejects.toMatchObject({ reason: "ATTEMPT-INVALID" });
});
it("does not accept a hash-consistent caller object as a live host-lock capability", async () => {
  const fixture = input();
  await expect(retireLegacyApplicationLogins(fixture.value)).rejects.toMatchObject({ reason: "LOCK-UNAVAILABLE" });
  expect(fixture.assertHeld).not.toHaveBeenCalled();
});
it("rejects a changed handoff before even checking the host lock", async () => {
  const fixture = input();
  await expect(retireLegacyApplicationLogins({ ...fixture.value, expectedHandoffDigest: `sha256:${"0".repeat(64)}` })).rejects.toMatchObject({ reason: "HANDOFF-MISMATCH" });
  expect(fixture.assertHeld).not.toHaveBeenCalled();
});
it.each([retireLegacyApplicationLogins, inspectLegacyApplicationLoginFence])("redacts malformed input at the public entry", async action => {
  await expect(action(null as unknown as LegacyLoginRetirementInput)).rejects.toThrow(/^PCAT-UPG-LEGACY-LOGIN-(OPERATION|INSPECTION)-FAILED$/);
});
