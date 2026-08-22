import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("self-hosted Compose entry", () => {
  it.each([
    ["`up --scale api=2`", ["up", "--scale", "api=2"]],
    ["`up --scale=api=2`", ["up", "--scale=api=2"]],
    ["`up --scale api=0`", ["up", "--scale", "api=0"]],
    ["`up --scale=api=00`", ["up", "--scale=api=00"]],
    ["`up --scale api=+2`", ["up", "--scale", "api=+2"]],
    ["`up --scale=api=garbage`", ["up", "--scale=api=garbage"]],
    ["a non-exact representation of one", ["up", "--scale=api=01"]],
    ["`scale api=2`", ["scale", "api=2"]],
    ["`scale api=0`", ["scale", "api=0"]],
    ["`scale api=garbage`", ["scale", "api=garbage"]],
    ["`scale -- api=2`", ["scale", "--", "api=2"]],
    [
      "`--env-file .env scale api=2`",
      ["--env-file", ".env", "scale", "api=2"]
    ],
    [
      "API replica counts larger than shell integer range",
      ["up", "--scale=api=18446744073709551616"]
    ]
  ])("rejects %s before invoking Docker", (_description, arguments_) => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-selfhost-compose-"));
    const docker = join(directory, "docker");
    const invocation = join(directory, "docker-invoked");
    writeFileSync(docker, `#!/bin/sh\ntouch '${invocation}'\n`);
    chmodSync(docker, 0o755);

    const result = spawnSync("bash", ["ops/self-hosted/scripts/compose", ...arguments_], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` }
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exactly one API replica");
    expect(existsSync(invocation)).toBe(false);
  });

  it.each([
    ["the supported API replica count", ["up", "--scale", "api=1"]],
    ["the supported standalone API replica count", ["scale", "api=1"]],
    ["an unrelated service replica count", ["up", "--scale=worker=2"]],
    ["an unrelated standalone service replica count", ["scale", "worker=2"]],
    [
      "container command arguments after `--`",
      ["run", "--rm", "api", "sh", "--", "--scale", "api=2"]
    ]
  ])("passes through %s", (_description, arguments_) => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-selfhost-compose-"));
    const docker = join(directory, "docker");
    const invocation = join(directory, "docker-invocation");
    writeFileSync(
      docker,
      `#!/bin/sh\nif [ "$1" = "compose" ] && [ "$2" = "version" ]; then\n  printf '%s\\n' 'Docker Compose version v2.39.1'\n  exit 0\nfi\nprintf '%s\\n' "$@" > '${invocation}'\n`
    );
    chmodSync(docker, 0o755);

    const result = spawnSync("bash", ["ops/self-hosted/scripts/compose", ...arguments_], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` }
    });

    expect(result.status).toBe(0);
    expect(readFileSync(invocation, "utf8")).toBe(["compose", ...arguments_].join("\n") + "\n");
  });

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
