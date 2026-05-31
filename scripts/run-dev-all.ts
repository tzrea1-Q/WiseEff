import { execFile, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

type RuntimeEnv = Record<string, string | undefined>;

export type DevAllCommand = {
  label: string;
  command: string;
  args: string[];
  env?: RuntimeEnv;
  shell?: boolean;
};

export type DevAllPlan = {
  prepare: DevAllCommand[];
  services: DevAllCommand[];
};

export type DevAllPortOptions = {
  databasePort: number;
  apiPort: number;
  webPort: number;
  shell: boolean;
};

export type DockerPortOwner = {
  id: string;
  image: string;
  names: string;
  ports: string;
};

export type DevAllPortRuntime = {
  isPortOpen(port: number): Promise<boolean>;
  findDockerOwnerByPublishedPort(port: number): Promise<DockerPortOwner | undefined>;
  fetchText(url: string): Promise<string | undefined>;
  findListeningPid(port: number): Promise<number | undefined>;
  killPid(pid: number): Promise<void>;
  runCommand(command: DevAllCommand): Promise<void>;
  waitForPortFree(port: number): Promise<void>;
};

export type DevAllPortRecoveryResult = {
  skipPrepareLabels: string[];
};

const seedScripts = ["db:seed:m0", "db:seed:m1", "db:seed:m2", "db:seed:m3"];
const execFileAsync = promisify(execFile);

export function buildDevAllPlan(env: RuntimeEnv = process.env, platform = process.platform): DevAllPlan {
  const npmShell = platform === "win32";
  const serviceEnv = normalizeLocalDevEnv(env);
  const apiBaseUrl =
    serviceEnv.VITE_WISEEFF_API_BASE_URL?.trim() ||
    serviceEnv.WISEEFF_API_BASE_URL?.trim() ||
    `http://127.0.0.1:${serviceEnv.PORT?.trim() || "8787"}`;
  const frontendEnv = {
    ...serviceEnv,
    VITE_WISEEFF_RUNTIME_MODE: "api",
    VITE_WISEEFF_API_BASE_URL: apiBaseUrl
  };

  return {
    prepare: [
      { label: "postgres", command: "docker", args: ["compose", "up", "-d", "postgres"], shell: false },
      {
        label: "postgres:ready",
        command: "docker",
        args: ["compose", "exec", "-T", "postgres", "sh", "-c", "until pg_isready -U wiseeff -d wiseeff; do sleep 1; done"],
        shell: false
      },
      { label: "database", command: "npm", args: ["run", "db:migrate"], env: serviceEnv, shell: npmShell },
      ...seedScripts.map((script) => ({
        label: script.replace("db:", ""),
        command: "npm",
        args: ["run", script],
        env: serviceEnv,
        shell: npmShell
      }))
    ],
    services: [
      { label: "api", command: "npm", args: ["run", "dev:api"], env: serviceEnv, shell: npmShell },
      { label: "web", command: "npm", args: ["run", "dev"], env: frontendEnv, shell: npmShell }
    ]
  };
}

function normalizeLocalDevEnv(env: RuntimeEnv): RuntimeEnv {
  const missingLiveAgentSettings =
    env.AGENT_PROVIDER === "live" && (!env.AGENT_API_BASE_URL?.trim() || !env.AGENT_MODEL?.trim() || !env.AGENT_API_KEY?.trim());

  return {
    DATABASE_URL: "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff",
    OBJECT_STORE_MODE: "local",
    OBJECT_STORE_ROOT: ".wiseeff-object-store",
    DEBUG_DEVICE_GATEWAY_MODE: "simulator",
    DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: "true",
    ...env,
    ...(missingLiveAgentSettings ? { AGENT_PROVIDER: "deterministic" } : {})
  };
}

export async function recoverDevAllPorts(
  options: DevAllPortOptions,
  runtime: DevAllPortRuntime = createNodePortRuntime(options.shell)
): Promise<DevAllPortRecoveryResult> {
  const skipPrepareLabels: string[] = [];

  if (await runtime.isPortOpen(options.databasePort)) {
    const owner = await runtime.findDockerOwnerByPublishedPort(options.databasePort);
    if (!owner || !isWiseEffPostgresOwner(owner)) {
      throw new Error(
        `Port ${options.databasePort} is already in use, but it does not look like a WiseEff PostgreSQL container. Stop the conflicting service or update DATABASE_URL before running dev:all.`
      );
    }

    await runtime.runCommand({ label: "postgres:restart-existing", command: "docker", args: ["restart", owner.id], shell: false });
    await runtime.runCommand({
      label: "postgres:ready-existing",
      command: "docker",
      args: ["exec", owner.id, "sh", "-c", "until pg_isready -U wiseeff -d wiseeff; do sleep 1; done"],
      shell: false
    });
    skipPrepareLabels.push("postgres", "postgres:ready");
  }

  await recoverHttpServicePort({
    port: options.apiPort,
    label: "API",
    url: `http://127.0.0.1:${options.apiPort}/health/live`,
    isExpected: (body) => looksLikeWiseEffApi(body),
    unknownMessage: `Port ${options.apiPort} is already in use, but it does not look like a WiseEff API service.`,
    runtime
  });

  await recoverHttpServicePort({
    port: options.webPort,
    label: "web",
    url: `http://127.0.0.1:${options.webPort}/`,
    isExpected: (body) => looksLikeWiseEffWeb(body),
    unknownMessage: `Port ${options.webPort} is already in use, but it does not look like a WiseEff web service.`,
    runtime
  });

  return { skipPrepareLabels };
}

function isWiseEffPostgresOwner(owner: DockerPortOwner) {
  const value = `${owner.image} ${owner.names}`.toLowerCase();
  return value.includes("postgres") && value.includes("wiseeff");
}

function looksLikeWiseEffApi(body: string | undefined) {
  if (!body) {
    return false;
  }

  return body.includes('"service":"wiseeff-api"') || body.includes('"service": "wiseeff-api"');
}

function looksLikeWiseEffWeb(body: string | undefined) {
  if (!body) {
    return false;
  }

  return body.includes("WiseEff") && body.includes('id="root"');
}

async function recoverHttpServicePort(options: {
  port: number;
  label: string;
  url: string;
  isExpected(body: string | undefined): boolean;
  unknownMessage: string;
  runtime: DevAllPortRuntime;
}) {
  if (!(await options.runtime.isPortOpen(options.port))) {
    return;
  }

  const body = await options.runtime.fetchText(options.url);
  if (!options.isExpected(body)) {
    throw new Error(`${options.unknownMessage} Stop the conflicting service before running dev:all.`);
  }

  const pid = await options.runtime.findListeningPid(options.port);
  if (!pid) {
    throw new Error(`Port ${options.port} is used by an existing WiseEff ${options.label} service, but the launcher could not find its process id.`);
  }

  await options.runtime.killPid(pid);
  await options.runtime.waitForPortFree(options.port);
}

function createNodePortRuntime(shell: boolean): DevAllPortRuntime {
  return {
    isPortOpen,
    findDockerOwnerByPublishedPort,
    fetchText,
    findListeningPid: process.platform === "win32" ? findWindowsListeningPid : findUnixListeningPid,
    killPid: process.platform === "win32" ? killWindowsPid : killUnixPid,
    runCommand,
    waitForPortFree,
    // shell is captured through runCommand command objects.
    ...(shell ? {} : {})
  };
}

function isPortOpen(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
    socket.setTimeout(750, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function findDockerOwnerByPublishedPort(port: number): Promise<DockerPortOwner | undefined> {
  const { stdout } = await execFileAsync("docker", ["ps", "-a", "--format", "{{.ID}}\t{{.Image}}\t{{.Names}}\t{{.Ports}}"]);
  const rows = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const row of rows) {
    const [id, image, names, ports] = row.split("\t");
    if (ports?.includes(`:${port}->`) || ports?.includes(`0.0.0.0:${port}->`) || ports?.includes(`127.0.0.1:${port}->`)) {
      return { id, image, names, ports };
    }
  }

  return undefined;
}

async function fetchText(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return await response.text();
  } catch {
    return undefined;
  }
}

async function findWindowsListeningPid(port: number) {
  const { stdout } = await execFileAsync("powershell", [
    "-NoProfile",
    "-Command",
    `(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`
  ]);
  const pid = Number(stdout.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

async function findUnixListeningPid(port: number) {
  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]);
    const pid = Number(stdout.trim().split(/\r?\n/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

async function killWindowsPid(pid: number) {
  await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]);
}

async function killUnixPid(pid: number) {
  process.kill(pid, "SIGTERM");
}

async function waitForPortFree(port: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(port))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Port ${port} is still in use after stopping the existing WiseEff service.`);
}

function runCommand(command: DevAllCommand) {
  return new Promise<void>((resolve, reject) => {
    console.log(`[dev:all] ${command.label}: ${command.command} ${command.args.join(" ")}`);
    const child = spawn(command.command, command.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...command.env },
      shell: command.shell,
      stdio: "inherit"
    });

    child.on("error", (error) => {
      reject(new Error(`${command.label} failed to start: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command.label} exited with ${signal ?? `code ${code ?? 1}`}.`));
    });
  });
}

function prefixOutput(label: string, stream: NodeJS.ReadableStream | null) {
  if (!stream) {
    return;
  }

  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      console.log(`[${label}] ${line}`);
    }
  });
  stream.on("end", () => {
    if (pending) {
      console.log(`[${label}] ${pending}`);
    }
  });
}

function startService(command: DevAllCommand) {
  console.log(`[dev:all] ${command.label}: ${command.command} ${command.args.join(" ")}`);
  const child = spawn(command.command, command.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...command.env },
    shell: command.shell,
    stdio: ["inherit", "pipe", "pipe"]
  });

  prefixOutput(command.label, child.stdout);
  prefixOutput(command.label, child.stderr);

  return child;
}

function stopServices(children: ChildProcess[]) {
  for (const child of children) {
    if (!child.killed && child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }
}

async function runDevAll() {
  await import("dotenv/config");
  const plan = buildDevAllPlan();
  const apiPort = Number(plan.services[0].env?.PORT ?? process.env.PORT ?? 8787);

  try {
    const recovery = await recoverDevAllPorts({ databasePort: 5432, apiPort, webPort: 5173, shell: process.platform === "win32" });
    const skipPrepareLabels = new Set(recovery.skipPrepareLabels);
    for (const step of plan.prepare) {
      if (skipPrepareLabels.has(step.label)) {
        console.log(`[dev:all] ${step.label}: skipped because an existing WiseEff service was recovered.`);
        continue;
      }
      await runCommand(step);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const services = plan.services.map(startService);
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    stopServices(services);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  for (const service of services) {
    service.on("error", (error) => {
      if (!shuttingDown) {
        console.error(error.message);
        shutdown();
        process.exitCode = 1;
      }
    });
    service.on("close", (code, signal) => {
      if (!shuttingDown) {
        console.error(`[dev:all] service exited with ${signal ?? `code ${code ?? 1}`}; stopping the remaining services.`);
        shutdown();
        process.exitCode = code ?? 1;
      }
    });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runDevAll();
}
