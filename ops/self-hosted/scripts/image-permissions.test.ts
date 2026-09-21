import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("makes restrictive checkout files readable by the operator UID without granting writes or making data executable", () => {
  const directory = mkdtempSync(join(tmpdir(), "wiseeff-image-permissions-"));
  try {
    const app = join(directory, "app");
    mkdirSync(app, { mode: 0o700 });
    const source = join(app, "package.json");
    const executable = join(app, "cli");
    writeFileSync(source, "{}", { mode: 0o600 });
    writeFileSync(executable, "#!/bin/sh\n", { mode: 0o700 });
    chmodSync(executable, 0o700);

    const dockerfile = readFileSync("ops/self-hosted/Dockerfile", "utf8");
    const permissionStep = dockerfile.split("\n").find((line) => line.startsWith("RUN chmod "));
    expect(permissionStep, "The runtime image must normalize checkout permissions").toBeDefined();
    expect(dockerfile.indexOf(permissionStep!)).toBeGreaterThan(dockerfile.lastIndexOf("COPY . ."));
    const result = spawnSync("sh", ["-c", permissionStep!.slice(4).replace("/app", '"$1"'), "image-permissions", app], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(statSync(source).mode & 0o777).toBe(0o644);
    expect(statSync(app).mode & 0o777).toBe(0o755);
    expect(statSync(executable).mode & 0o777).toBe(0o755);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
