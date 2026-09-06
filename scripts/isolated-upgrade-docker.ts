import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

type Runner = (args: string[], env: NodeJS.ProcessEnv, input?: Buffer) => Buffer;
const runDocker: Runner = (args, env, input) => {
  try {
    const result = spawnSync("docker", args, { env, input, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0 || result.error) throw new Error();
    return result.stdout;
  } catch { throw new Error("isolated-docker-operation-failed"); }
};

/** Resolve configuration read-only, then pin every call to the same local daemon.
 * Never inherits remote Docker endpoints, TLS credentials or application secrets.
 */
export function createIsolatedUpgradeDocker(environment: NodeJS.ProcessEnv = process.env, runner: Runner = runDocker) {
  const env = { PATH: environment.PATH, HOME: os.homedir() };
  const safeRun: Runner = (args, childEnv, input) => {
    try { return runner(args, childEnv, input); }
    catch { throw new Error("isolated-docker-operation-failed"); }
  };
  const approve = (host: string) => {
    if (!["unix:///var/run/docker.sock", `unix://${path.join(os.homedir(), ".docker/run/docker.sock")}`].includes(host)) {
      throw new Error("isolated-docker-local-endpoint-required");
    }
    return host;
  };
  // Reject even a shadowed remote DOCKER_HOST; no test switch can bypass this.
  if (environment.DOCKER_HOST) approve(environment.DOCKER_HOST);
  let host = environment.DOCKER_HOST;
  if (environment.DOCKER_CONTEXT || !host) {
    const contextEnv = { ...env, ...(environment.DOCKER_CONFIG ? { DOCKER_CONFIG: environment.DOCKER_CONFIG } : {}) };
    const context = environment.DOCKER_CONTEXT || safeRun(["context", "show"], contextEnv).toString().trim();
    if (!context || context.startsWith("-")) throw new Error("isolated-docker-context-invalid");
    try {
      const config = JSON.parse(safeRun(["context", "inspect", context], contextEnv).toString());
      host = config[0]?.Endpoints?.docker?.Host;
    } catch { throw new Error("isolated-docker-context-invalid"); }
  }
  const endpoint = approve(host ?? "");
  const pinned = (args: string[], input?: Buffer) => safeRun(["--host", endpoint, ...args], env, input);
  const daemonId = pinned(["info", "--format", "{{.ID}}"]).toString().trim();
  if (!daemonId || /\s/.test(daemonId)) throw new Error("isolated-docker-daemon-identity-missing");
  const command = (args: string[], input?: Buffer) => {
    if (pinned(["info", "--format", "{{.ID}}"]).toString().trim() !== daemonId) throw new Error("isolated-docker-daemon-identity-changed");
    return pinned(args, input);
  };
  const assertOwned = (id: string, label: string, run: string) => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("isolated-docker-container-identity-invalid");
    let info;
    try { info = JSON.parse(command(["inspect", id]).toString())[0]; }
    catch { throw new Error("isolated-docker-container-inspection-failed"); }
    if (info?.Id !== id || info?.Config?.Labels?.[label] !== run) throw new Error("isolated-docker-container-ownership-mismatch");
    return info;
  };
  return { command, assertOwned, daemonId };
}
