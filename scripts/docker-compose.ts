import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ComposeVersion = [major: number, minor: number, patch: number];

export type DockerComposeInvocation = {
  command: string;
  composeArgsPrefix: string[];
  fileArgs: string[];
};

export type DockerComposeProbe = (command: string, args: string[]) => Promise<boolean>;
export type DockerComposeVersionReader = (command: string, args: string[]) => Promise<string | undefined>;

export const MIN_DOCKER_COMPOSE_V1: ComposeVersion = [1, 28, 0];

export const DEFAULT_DOCKER_COMPOSE_INVOCATION: DockerComposeInvocation = {
  command: "docker",
  composeArgsPrefix: ["compose"],
  fileArgs: []
};

const defaultProbe: DockerComposeProbe = async (command, args) => {
  try {
    await execFileAsync(command, args, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
};

const defaultVersionReader: DockerComposeVersionReader = async (command, args) => {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 10_000 });
    return stdout;
  } catch {
    return undefined;
  }
};

export function parseComposeVersion(output: string): ComposeVersion | undefined {
  const match = output.match(/(?:^|\s)v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareComposeVersions(left: ComposeVersion, right: ComposeVersion) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) {
      return 1;
    }
    if (left[index] < right[index]) {
      return -1;
    }
  }

  return 0;
}

export function isComposeVersionSupported(version: ComposeVersion, minimumV1: ComposeVersion = MIN_DOCKER_COMPOSE_V1) {
  if (version[0] >= 2) {
    return true;
  }

  return compareComposeVersions(version, minimumV1) >= 0;
}

export function formatMinimumComposeRequirement(minimumV1: ComposeVersion = MIN_DOCKER_COMPOSE_V1) {
  return `docker compose (v2 plugin) or docker-compose ${minimumV1.join(".")}+`;
}

export async function resolveDockerCompose(
  options: {
    composeFile?: string;
    probe?: DockerComposeProbe;
    readVersion?: DockerComposeVersionReader;
    minimumV1?: ComposeVersion;
  } = {}
): Promise<DockerComposeInvocation> {
  const composeFile = options.composeFile ?? "compose.yaml";
  const probe = options.probe ?? defaultProbe;
  const readVersion = options.readVersion ?? defaultVersionReader;
  const minimumV1 = options.minimumV1 ?? MIN_DOCKER_COMPOSE_V1;
  const requirement = formatMinimumComposeRequirement(minimumV1);

  if (await probe("docker", ["compose", "version"])) {
    const versionOutput = await readVersion("docker", ["compose", "version"]);
    const version = versionOutput ? parseComposeVersion(versionOutput) : undefined;
    if (version && !isComposeVersionSupported(version, minimumV1)) {
      throw new Error(`Docker Compose ${version.join(".")} is too old. Install ${requirement}.`);
    }

    return DEFAULT_DOCKER_COMPOSE_INVOCATION;
  }

  if ((await probe("docker-compose", ["version"])) || (await probe("docker-compose", ["--version"]))) {
    let version: ComposeVersion | undefined;
    for (const args of [["version"], ["--version"]] as const) {
      const versionOutput = await readVersion("docker-compose", args);
      version = versionOutput ? parseComposeVersion(versionOutput) : undefined;
      if (version) {
        break;
      }
    }
    if (!version) {
      throw new Error(`Could not determine docker-compose version. Install ${requirement}.`);
    }
    if (!isComposeVersionSupported(version, minimumV1)) {
      throw new Error(`docker-compose ${version.join(".")} is too old. Install ${requirement}.`);
    }

    return {
      command: "docker-compose",
      composeArgsPrefix: [],
      fileArgs: ["-f", composeFile]
    };
  }

  throw new Error(`Neither 'docker compose' nor 'docker-compose' is available. Install ${requirement}.`);
}

export function buildDockerComposeCommand(invocation: DockerComposeInvocation, args: string[]) {
  return {
    command: invocation.command,
    args: [...invocation.composeArgsPrefix, ...invocation.fileArgs, ...args]
  };
}
