import { describe, expect, it } from "vitest";
import { evaluateRestoreTargets, parseRestoreDrillArgs } from "./run-restore-drill";

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

  it("loads dotenv restore targets without requiring shell source", () => {
    const env = parseRestoreDrillArgs(["--env-file", "target.env"], {
      fileSystem: {
        existsSync: (filePath) => filePath === "target.env",
        readFileSync: () =>
          [
            "DATABASE_URL=postgres://wiseeff:secret@postgres:5432/wiseeff",
            "RESTORE_DATABASE_URL=postgres://wiseeff_restore:secret@postgres:5432/wiseeff_restore",
            "OBJECT_STORAGE_BUCKET=wiseeff-prod",
            "RESTORE_OBJECT_STORAGE_BUCKET=wiseeff-restore",
            "RESTORE_OBJECT_STORAGE_PREFIX=m6-drill/",
            "M6_SELFHOSTED_SMOKE_AUTHORIZATION=Bearer token with spaces"
          ].join("\n")
      },
      processEnv: {}
    });

    expect(env).toMatchObject({
      DATABASE_URL: "postgres://wiseeff:secret@postgres:5432/wiseeff",
      RESTORE_DATABASE_URL: "postgres://wiseeff_restore:secret@postgres:5432/wiseeff_restore",
      OBJECT_STORAGE_BUCKET: "wiseeff-prod",
      RESTORE_OBJECT_STORAGE_BUCKET: "wiseeff-restore",
      RESTORE_OBJECT_STORAGE_PREFIX: "m6-drill/",
      M6_SELFHOSTED_SMOKE_AUTHORIZATION: "Bearer token with spaces"
    });
  });

  it("supports target-env-file aliases that do not conflict with Node flags", () => {
    const fileSystem = {
      existsSync: (filePath: string) => filePath === "target.env",
      readFileSync: () =>
        [
          "RESTORE_DATABASE_URL=postgres://wiseeff_restore@postgres:5432/wiseeff_restore",
          "RESTORE_OBJECT_STORAGE_BUCKET=wiseeff-restore",
          "RESTORE_OBJECT_STORAGE_PREFIX=m6-drill/"
        ].join("\n")
    };

    expect(
      parseRestoreDrillArgs(["--target-env-file=target.env"], {
        fileSystem,
        processEnv: {}
      })
    ).toMatchObject({
      RESTORE_DATABASE_URL: "postgres://wiseeff_restore@postgres:5432/wiseeff_restore"
    });
    expect(
      parseRestoreDrillArgs([], {
        fileSystem,
        processEnv: { npm_config_target_env_file: "target.env" }
      })
    ).toMatchObject({
      RESTORE_OBJECT_STORAGE_BUCKET: "wiseeff-restore"
    });
    expect(
      parseRestoreDrillArgs(["target.env"], {
        fileSystem,
        processEnv: { npm_config_target_env_file: "true" }
      })
    ).toMatchObject({
      RESTORE_OBJECT_STORAGE_PREFIX: "m6-drill/"
    });
  });
});
