import { describe, expect, it } from "vitest";
import { evaluateRestoreTargets } from "./run-restore-drill";

describe("M6.3 restore drill target safety", () => {
  it("allows explicitly isolated database and object-store restore targets", () => {
    expect(
      evaluateRestoreTargets({
        liveDatabaseUrl: "postgres://wiseeff@localhost:5432/wiseeff",
        restoreDatabaseUrl: "postgres://wiseeff_restore@localhost:5432/wiseeff_restore",
        liveBucket: "wiseeff-prod",
        restoreBucket: "wiseeff-restore",
        restorePrefix: "m6-drill/2026-06-02/"
      })
    ).toEqual({
      status: "passed",
      unsafeFields: [],
      validationErrors: []
    });
  });

  it("rejects live production database and bucket restore targets before commands run", () => {
    const result = evaluateRestoreTargets({
      liveDatabaseUrl: "postgres://wiseeff@localhost:5432/wiseeff",
      restoreDatabaseUrl: "postgres://wiseeff@localhost:5432/wiseeff",
      liveBucket: "wiseeff-prod",
      restoreBucket: "wiseeff-prod",
      restorePrefix: ""
    });

    expect(result.status).toBe("failed");
    expect(result.unsafeFields).toEqual(
      expect.arrayContaining(["restoreDatabaseUrl", "restoreBucket", "restorePrefix"])
    );
    expect(result.validationErrors).toEqual(
      expect.arrayContaining([
        "restoreDatabaseUrl must not match the live database URL.",
        "restoreBucket must not match the live object-store bucket.",
        "restorePrefix must be non-empty and end with '/'."
      ])
    );
  });
});
