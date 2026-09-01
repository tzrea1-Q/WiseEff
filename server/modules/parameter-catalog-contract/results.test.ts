import { describe, expect, it } from "vitest";

import {
  CatalogMaterializationFingerprint,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseVersion,
  MaintenanceAttemptId,
  type CatalogKernelError,
  type InstallResult,
  type OptionalValue,
  type Result,
  type SwitchBackResult,
  type VerificationResult
} from "./index";

const unwrap = <T>(result: Result<T, CatalogKernelError>): T | string => {
  switch (result.ok) {
    case true:
      return result.value;
    case false:
      return result.error.kind;
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
};

const release = {
  id: CatalogReleaseId("crel_01K42"),
  version: CatalogReleaseVersion("2026.09.01"),
  digest: CatalogReleaseDigest("sha256:release")
};

const unwrapOptional = <T>(value: OptionalValue<T>): T | undefined => {
  switch (value.kind) {
    case "present":
      return value.value;
    case "absent":
      return undefined;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
};

const counts = {
  subjects: 2,
  subjectMemberships: 2,
  aliases: 1,
  aliasMemberships: 1,
  definitions: 3,
  definitionRevisions: 4
};

describe("parameter catalog operation results", () => {
  it("keeps Result success and failure explicitly tagged", () => {
    expect(unwrap({ ok: true, value: "ready" })).toBe("ready");
    expect(
      unwrap({
        ok: false,
        error: { kind: "synchronization-busy", retryable: true }
      })
    ).toBe("synchronization-busy");
    expect(unwrapOptional({ kind: "present", value: "current" })).toBe("current");
    expect(unwrapOptional({ kind: "absent" })).toBeUndefined();
  });

  it("keeps installation and switch-back result shapes closed", () => {
    const installed: InstallResult = {
      status: "installed",
      mode: "bootstrap",
      previous: null,
      current: release,
      materializationFingerprint: CatalogMaterializationFingerprint("sha256:materialized"),
      counts
    };
    const switchedBack: SwitchBackResult = {
      status: "switched-back",
      maintenanceAttemptId: MaintenanceAttemptId("maint_01KCUTOVER"),
      previousCurrent: release,
      current: release,
      materializationFingerprint: CatalogMaterializationFingerprint("sha256:previous")
    };

    expect(installed.status).toBe("installed");
    expect(switchedBack.status).toBe("switched-back");
  });

  it("keeps independent verification all-or-nothing", () => {
    const verified: VerificationResult = {
      status: "verified",
      release,
      materializationFingerprint: CatalogMaterializationFingerprint("sha256:verified"),
      verifiedAt: "2026-09-01T00:00:00.000Z",
      checks: [{ code: "compiled-release", status: "passed" }],
      counts
    };

    expect(verified.status).toBe("verified");
    expect(verified.checks).toEqual([{ code: "compiled-release", status: "passed" }]);
  });
});
