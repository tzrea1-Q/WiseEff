import { chmodSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { redactPostgresUrl, writeRuntimeLoginSecrets } from "./runtimeLoginSecrets";

describe("runtime login secret files", () => {
  it("writes 0600 files and redacts passwords", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-cred-"));
    chmodSync(directory, 0o700);
    const written = writeRuntimeLoginSecrets({
      directory,
      apiUrl: "postgres://wiseeff_api:secret-api@127.0.0.1:5432/db",
      workerUrl: "postgres://wiseeff_worker:secret-worker@127.0.0.1:5432/db",
      managerUrl: "postgres://wiseeff_publication_manager:secret-mgr@127.0.0.1:5432/db",
    });
    expect(readFileSync(written.api, "utf8")).toContain("secret-api");
    expect(redactPostgresUrl("postgres://wiseeff_api:secret-api@127.0.0.1:5432/db")).not.toContain("secret-api");
    expect(() =>
      writeRuntimeLoginSecrets({
        directory,
        apiUrl: "postgres://wiseeff_api:other@127.0.0.1:5432/db",
        workerUrl: "postgres://wiseeff_worker:other@127.0.0.1:5432/db",
        managerUrl: "postgres://wiseeff_publication_manager:other@127.0.0.1:5432/db",
      }),
    ).toThrow(/overwrite/);
  });

  it("refuses a symlink credential path", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-cred-link-"));
    chmodSync(directory, 0o700);
    const target = join(directory, "target.dsn");
    writeFileSync(target, "postgres://x:y@127.0.0.1/db\n", { mode: 0o600 });
    symlinkSync(target, join(directory, "api.dsn"));
    expect(() =>
      writeRuntimeLoginSecrets({
        directory,
        apiUrl: "postgres://wiseeff_api:secret@127.0.0.1:5432/db",
        workerUrl: "postgres://wiseeff_worker:secret@127.0.0.1:5432/db",
        managerUrl: "postgres://wiseeff_publication_manager:secret@127.0.0.1:5432/db",
        overwrite: true,
      }),
    ).toThrow(/symbolic link/);
  });

  it("refuses a group-readable credential directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-cred-open-"));
    chmodSync(directory, 0o755);
    expect(() =>
      writeRuntimeLoginSecrets({
        directory,
        apiUrl: "postgres://wiseeff_api:secret@127.0.0.1:5432/db",
        workerUrl: "postgres://wiseeff_worker:secret@127.0.0.1:5432/db",
        managerUrl: "postgres://wiseeff_publication_manager:secret@127.0.0.1:5432/db",
      }),
    ).toThrow(/group\/world/);
  });
});
