import { describe, expect, it } from "vitest";

import { catalogLegacyGoneResult, LEGACY_WRITE_GONE_MESSAGE } from "../server/modules/parameter-catalog-api/legacy";
import {
  parseReconcileCliCommand,
  runReconcileParameterDefinitions,
} from "./reconcile-parameter-definitions";

describe("reconcile-parameter-definitions CLI", () => {
  it("maps --apply to a typed S8-LEG structural-write 410", async () => {
    expect(parseReconcileCliCommand(["--apply"])).toEqual({ kind: "apply-gone" });
    const result = await runReconcileParameterDefinitions(["--apply"], {});
    expect(result.exitCode).toBe(2);
    expect(result.body).toEqual(catalogLegacyGoneResult("ops-reconcile-apply", LEGACY_WRITE_GONE_MESSAGE));
  });

  it("maps --verify to a typed readReport command", () => {
    expect(parseReconcileCliCommand(["--verify", "--report-id", "vreport_1"])).toEqual({
      kind: "verify",
      reportIdOrDigest: "vreport_1",
    });
    expect(parseReconcileCliCommand(["--verify", "--catalog-only", "--run-id", "digest-1"])).toEqual({
      kind: "verify",
      reportIdOrDigest: "digest-1",
    });
  });

  it("maps default and --dry-run to typed cutover inspect", () => {
    expect(parseReconcileCliCommand([])).toEqual({
      kind: "inspect",
      runId: undefined,
      planDigest: undefined,
      phase: undefined,
    });
    expect(parseReconcileCliCommand(["--dry-run", "--run-id", "cutover_1", "--plan-digest", "sha256:plan"])).toEqual({
      kind: "inspect",
      runId: "cutover_1",
      planDigest: "sha256:plan",
      phase: undefined,
    });
  });

  it("maps exact legacy identifier lookup to S8-LEG", () => {
    expect(
      parseReconcileCliCommand([
        "--legacy-type",
        "parameter-spec",
        "--legacy-id",
        "spec-1",
        "--organization-id",
        "org-1",
      ]),
    ).toEqual({
      kind: "legacy",
      legacyType: "parameter-spec",
      legacyId: "spec-1",
      organizationId: "org-1",
    });
  });

  it("rejects combined verify and mutate flags", () => {
    expect(() => parseReconcileCliCommand(["--verify", "--apply"])).toThrow(
      "--verify cannot be combined with --dry-run or --apply.",
    );
    expect(() => parseReconcileCliCommand(["--catalog-only"])).toThrow("--catalog-only requires --verify.");
  });
});
