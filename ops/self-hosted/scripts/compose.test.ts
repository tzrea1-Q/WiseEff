import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("self-hosted Compose entry", () => {
  it("rejects standalone Compose v1 because restricted builds require BuildKit secrets", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-selfhost-compose-"));
    const docker = join(directory, "docker");
    writeFileSync(docker, "#!/bin/sh\nprintf '%s\\n' 'Docker Compose version v1.29.2'\n");
    chmodSync(docker, 0o755);

    const result = spawnSync("bash", ["ops/self-hosted/scripts/compose", "version"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` }
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Docker Compose v2");
  });
});
