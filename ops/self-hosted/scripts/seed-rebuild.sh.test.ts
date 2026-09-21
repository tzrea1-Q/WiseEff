import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = "ops/self-hosted/scripts/seed-rebuild.sh";

function executable(path: string, contents: string) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-rebuild-"));
  const repo = join(directory, "repo");
  const composeDir = join(directory, "compose");
  const state = join(directory, "state");
  const backup = join(directory, "backup");
  const envFile = join(composeDir, ".env");
  const compose = join(directory, "compose-mock");
  const docker = join(directory, "docker-mock");
  const invocation = join(directory, "compose-invocation");

  mkdirSync(composeDir);
  spawnSync("git", ["init", "-q", repo]);
  spawnSync("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  spawnSync("git", ["-C", repo, "config", "user.name", "Test"]);
  writeFileSync(join(repo, "README"), "test\n");
  spawnSync("git", ["-C", repo, "add", "README"]);
  spawnSync("git", ["-C", repo, "commit", "-qm", "fixture"]);
  const sha = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();

  writeFileSync(
    envFile,
    [
      "DATABASE_URL=postgres://wiseeff:secret@example.invalid/wiseeff",
      "WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL=postgres://bootstrap:secret@example.invalid/wiseeff",
      "POSTGRES_PASSWORD=secret",
      "OBJECT_STORE_MODE=s3",
      "OBJECT_STORAGE_ENDPOINT=http://minio:9000",
      "OBJECT_STORAGE_BUCKET=wiseeff",
      "OBJECT_STORAGE_ACCESS_KEY_ID=access",
      "OBJECT_STORAGE_SECRET_ACCESS_KEY=secret",
      "LOG_ANALYSIS_QUEUE_MODE=polling",
      "NOTIFICATION_QUEUE_MODE=polling",
    ].join("\n") + "\n",
    { mode: 0o600 },
  );
  executable(
    compose,
    [
      "#!/bin/sh",
      "printf '%s\\n' \\\"$*\\\" >> '" + invocation + "'",
      "mount=''",
      "previous=''",
      "for argument in \"$@\"; do",
      "  if [ \"$previous\" = -v ]; then mount=\"$argument\"; fi",
      "  previous=\"$argument\"",
      "done",
      "run_dir=$(printf '%s' \"$mount\" | sed 's#:/run/wiseeff-seed-rebuild:rw$##')",
      "cat > \"$run_dir/core-state.json\" <<EOF",
      "{\"plan\":{\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"candidateSha\":\"" + sha + "\",\"organizationId\":\"org-test\",\"actorUserId\":\"operator@example.invalid\",\"seedDigest\":\"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"scope\":\"atlas-aurora-nebula\"}}",
      "EOF",
      "printf '%s\\n' 'diagnostic postgres://user:secret@example.invalid/db?password=secret'",
    ].join("\n") + "\n",
  );
  executable(docker, ["#!/bin/sh", "if [ \"$1\" = info ]; then printf '%s\\n' /var/lib/docker; exit 0; fi", "exit 0", ""].join("\n"));
  return { directory, repo, composeDir, state, backup, envFile, compose, docker, invocation };
}

describe("self-hosted seed rebuild boundary", () => {
  it("runs the read-only plan through a mocked one-off and sanitizes diagnostics", () => {
    const f = fixture();
    const result = spawnSync(
      "bash",
      [script, "plan", "--run-id", "run1", "--actor", "operator@example.invalid", "--organization-id", "org-test"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          WISEEFF_SEED_REBUILD_REPO_ROOT: f.repo,
          WISEEFF_SEED_REBUILD_COMPOSE_DIR: f.composeDir,
          WISEEFF_SEED_REBUILD_COMPOSE: f.compose,
          WISEEFF_SEED_REBUILD_DOCKER: f.docker,
          WISEEFF_SEED_REBUILD_ENV_FILE: f.envFile,
          WISEEFF_SEED_REBUILD_STATE_DIR: f.state,
          WISEEFF_SEED_REBUILD_BACKUP_ROOT: f.backup,
          WISEEFF_SEED_REBUILD_LOCK_DIR: join(f.directory, "locks"),
        },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Seed rebuild plan recorded. run_id=run1");
    expect(result.stdout).not.toContain("secret");
    const runDir = join(f.state, "run1");
    expect(existsSync(join(runDir, "core-state.json"))).toBe(true);
    expect(readFileSync(join(runDir, "core-output"), "utf8")).not.toContain("secret");
    const invocation = readFileSync(f.invocation, "utf8");
    expect(invocation).toContain("--run-id\nrun1");
    expect(invocation).not.toContain("--scope");
  });

  it("rejects arbitrary core arguments and malformed digests before Docker", () => {
    const help = spawnSync("bash", [script, "command", "--run-id", "run1", "--core-command", "rebuild", "--evil"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(help.status).not.toBe(0);
    expect(help.stderr).toContain("Unknown option: --evil");

    const digest = spawnSync("bash", [script, "begin", "--run-id", "run1", "--confirm-plan", "sha256:not-a-digest"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(digest.status).not.toBe(0);
    expect(digest.stderr).toContain("Expected a sha256:<64 lowercase hexadecimal> digest");
  });
});
