import { describe, expect, it, vi } from "vitest";
import {
  buildDockerComposeCommand,
  compareComposeVersions,
  DEFAULT_DOCKER_COMPOSE_INVOCATION,
  isComposeVersionSupported,
  parseComposeVersion,
  resolveDockerCompose,
  type DockerComposeProbe,
  type DockerComposeVersionReader
} from "./docker-compose";

function createProbe(responses: Record<string, boolean>): DockerComposeProbe {
  return vi.fn(async (command, args) => responses[`${command} ${args.join(" ")}`] ?? false);
}

function createVersionReader(responses: Record<string, string>): DockerComposeVersionReader {
  return vi.fn(async (command, args) => responses[`${command} ${args.join(" ")}`]);
}

describe("parseComposeVersion", () => {
  it("parses docker compose and docker-compose version output", () => {
    expect(parseComposeVersion("Docker Compose version v2.29.1-desktop.1")).toEqual([2, 29, 1]);
    expect(parseComposeVersion("docker-compose version 1.29.2, build 5becea4c")).toEqual([1, 29, 2]);
  });
});

describe("isComposeVersionSupported", () => {
  it("accepts compose v2 and docker-compose 1.28+", () => {
    expect(isComposeVersionSupported([2, 0, 0])).toBe(true);
    expect(isComposeVersionSupported([1, 28, 0])).toBe(true);
    expect(isComposeVersionSupported([1, 29, 2])).toBe(true);
    expect(isComposeVersionSupported([1, 27, 9])).toBe(false);
  });
});

describe("compareComposeVersions", () => {
  it("orders semantic compose versions", () => {
    expect(compareComposeVersions([1, 29, 0], [1, 28, 0])).toBe(1);
    expect(compareComposeVersions([1, 27, 0], [1, 28, 0])).toBe(-1);
  });
});

describe("resolveDockerCompose", () => {
  it("prefers docker compose when the v2 plugin is available", async () => {
    const probe = createProbe({
      "docker compose version": true,
      "docker-compose version": true
    });
    const readVersion = createVersionReader({
      "docker compose version": "Docker Compose version v2.29.1"
    });

    await expect(resolveDockerCompose({ probe, readVersion })).resolves.toEqual(DEFAULT_DOCKER_COMPOSE_INVOCATION);
  });

  it("falls back to docker-compose when only the standalone binary is available", async () => {
    const probe = createProbe({
      "docker compose version": false,
      "docker-compose version": false,
      "docker-compose --version": true
    });
    const readVersion = createVersionReader({
      "docker-compose version": "",
      "docker-compose --version": "docker-compose version 1.29.2, build 5becea4c"
    });

    await expect(resolveDockerCompose({ composeFile: "compose.yaml", probe, readVersion })).resolves.toEqual({
      command: "docker-compose",
      composeArgsPrefix: [],
      fileArgs: ["-f", "compose.yaml"]
    });
  });

  it("rejects docker-compose versions that are too old for the self-hosted compose file", async () => {
    const probe = createProbe({
      "docker compose version": false,
      "docker-compose version": true
    });
    const readVersion = createVersionReader({
      "docker-compose version": "docker-compose version 1.17.1, build 8741809"
    });

    await expect(resolveDockerCompose({ probe, readVersion })).rejects.toThrow("docker-compose 1.17.1 is too old");
  });

  it("throws when neither compose command is available", async () => {
    const probe = createProbe({});

    await expect(resolveDockerCompose({ probe })).rejects.toThrow(/Neither 'docker compose' nor 'docker-compose' is available/);
  });
});

describe("buildDockerComposeCommand", () => {
  it("builds docker compose v2 commands without an explicit compose file", () => {
    expect(buildDockerComposeCommand(DEFAULT_DOCKER_COMPOSE_INVOCATION, ["up", "-d", "postgres"])).toEqual({
      command: "docker",
      args: ["compose", "up", "-d", "postgres"]
    });
  });

  it("builds docker-compose v1 commands with an explicit compose file", () => {
    expect(
      buildDockerComposeCommand(
        {
          command: "docker-compose",
          composeArgsPrefix: [],
          fileArgs: ["-f", "compose.yaml"]
        },
        ["exec", "-T", "postgres", "sh", "-c", "echo ready"]
      )
    ).toEqual({
      command: "docker-compose",
      args: ["-f", "compose.yaml", "exec", "-T", "postgres", "sh", "-c", "echo ready"]
    });
  });
});
