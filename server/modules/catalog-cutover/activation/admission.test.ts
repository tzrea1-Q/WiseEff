import { expect, it, vi } from "vitest";
import type { ReleaseVerificationReport } from "../../release-verification/core";
import { createP12Activation, type ActivationOptions } from "./index";

function input() {
  const connect = vi.fn(async () => { throw new Error("unexpected database connection"); });
  const owner = { withLockedBoundary: async <T>(body: () => Promise<T>) => body(),
    verify: vi.fn(async () => undefined), observeBoundary: vi.fn(async () => { throw new Error("not installed"); }) };
  return { connect, owner, options: { managementPool: { connect }, catalogReadConnectionString: "postgres://synthetic@invalid/unused", reportDatabase: {},
    target: { systemIdentifier: "synthetic", databaseOid: "1" }, runId: "run", expectedMigrations: [{ name: "candidate.sql", checksum: "a".repeat(64) }], owner } as unknown as ActivationOptions };
}

it("refuses a missing actual owner before opening a connection", () => {
  const fixture = input();
  expect(() => createP12Activation({ ...fixture.options, owner: undefined as never })).toThrow("p12-owner-unavailable");
  expect(fixture.connect).not.toHaveBeenCalled();
});

it("refuses an empty migration inventory before opening a connection", () => {
  const fixture = input();
  expect(() => createP12Activation({ ...fixture.options, expectedMigrations: [] })).toThrow("p12-input-incomplete");
  expect(fixture.connect).not.toHaveBeenCalled();
});

it("does not expose standalone activation of a caller-built passed report", async () => {
  const fixture = input(); const target = createP12Activation(fixture.options).installTarget("attempt");
  await expect(target.activateP12({ decision: "passed" } as ReleaseVerificationReport)).rejects.toThrow("p12-dispatcher-boundary-required");
  await expect(target.observeBoundary()).rejects.toThrow("p12-dispatcher-boundary-required");
  expect(fixture.connect).not.toHaveBeenCalled();
});

it.each(["", "../other", "another run", "x".repeat(161)])("refuses invalid attempt identity %s", attempt => {
  const fixture = input();
  expect(() => createP12Activation(fixture.options).installTarget(attempt)).toThrow("p12-attempt-invalid");
  expect(fixture.connect).not.toHaveBeenCalled();
});

it("does not turn P12 installation into runtime or public-release effects", async () => {
  const fixture = input(); const target = createP12Activation(fixture.options).installTarget("attempt");
  await expect(target.startCandidate({} as ReleaseVerificationReport)).rejects.toThrow("p12-runtime-effect-not-installed");
  await expect(target.releasePublic({} as ReleaseVerificationReport)).rejects.toThrow("p12-public-effect-not-installed");
  expect(fixture.connect).not.toHaveBeenCalled();
});

it("releases its dispatcher state after an exception and rejects reentrant use", async () => {
  const fixture = input(); const target = createP12Activation(fixture.options).installTarget("attempt");
  await expect(target.withExclusiveBoundary(() => target.withExclusiveBoundary(async () => undefined))).rejects.toThrow("p12-dispatcher-reentrant");
  expect(await target.withExclusiveBoundary(async () => "released")).toBe("released");
  await expect(target.observeBoundary()).rejects.toThrow("p12-dispatcher-boundary-required");
  expect(fixture.connect).not.toHaveBeenCalled();
});

it("redacts unexpected owner failures before inspection without opening the database", async () => {
  const fixture = input();
  const activation = createP12Activation({ ...fixture.options, owner: { ...fixture.owner,
    async withLockedBoundary() { throw new Error("private target credential detail"); },
  } });
  try {
    await expect(activation.inspect()).rejects.toThrow("p12-boundary-unavailable");
    expect(fixture.connect).not.toHaveBeenCalled();
  } finally { await activation.close(); }
});
