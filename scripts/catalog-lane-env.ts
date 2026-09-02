import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_LANE_HOST = "127.0.0.1";
export const DEFAULT_LANE_PORT = 55438;
export const DEFAULT_LANE_USER = "wiseeff";
export const DEFAULT_LANE_PASSWORD = "wiseeff";
export const DEFAULT_LANE_ADMIN_DATABASE = "postgres";
export const DEFAULT_LANE_CONTAINER = "wiseeff-g668-pg";
export const DEFAULT_LANE_IMAGE = "pgvector/pgvector:pg16";
export const COMPOSE_APP_PORT = 5432;
export const COMPOSE_APP_DATABASE = "wiseeff";
export const CATALOG_MIGRATION_OWNER_ROLE = "catalog_migration_owner";
export const ROLE_CANARY_SQL =
  "select 1 as ok from public.parameter_specs limit 1";

const FAKE_ENGINE_PATTERN = /pglite|postgres-js|pg-mem|sqlite|:memory:|memory:\/\//i;
const REPAIR_DATABASE_PATTERN = /^(wiseeff_s2rbac_r\d+|wiseeff_s2pgh_r\d+)$/;
const HARNESS_DATABASE_PATTERN = /^(wiseeff_pcat_|wiseeff_test_tpl_)/;

export type CatalogLaneCommand = "doctor" | "provision" | "accept" | "cleanup" | "help";

export type CatalogLaneArgs = {
  command: CatalogLaneCommand;
  issue: number | null;
  reset: boolean;
  abandoned: boolean;
  commandArgv: string[];
  databaseUrl: string | null;
};

export class CatalogLaneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogLaneError";
  }
}

export function laneDatabaseName(issue: number): string {
  if (!Number.isInteger(issue) || issue <= 0) {
    throw new CatalogLaneError("Catalog lane provision requires a positive integer --issue");
  }
  return `wiseeff_lane_${issue}`;
}

export function defaultLaneAdminUrl(): string {
  return connectionStringFor(DEFAULT_LANE_ADMIN_DATABASE);
}

export function connectionStringFor(
  database: string,
  options: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
  } = {},
): string {
  const host = options.host ?? DEFAULT_LANE_HOST;
  const port = options.port ?? DEFAULT_LANE_PORT;
  const user = options.user ?? DEFAULT_LANE_USER;
  const password = options.password ?? DEFAULT_LANE_PASSWORD;
  return `postgres://${user}:${password}@${host}:${port}/${database}`;
}

export function parsePostgresUrl(connectionString: string): URL {
  const trimmed = connectionString.trim();
  if (!trimmed) {
    throw new CatalogLaneError("Catalog lane URL is empty");
  }
  if (FAKE_ENGINE_PATTERN.test(trimmed)) {
    throw new CatalogLaneError(
      "Catalog lane evidence rejects PGLite, SQLite, in-memory, and fake databases",
    );
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new CatalogLaneError("Catalog lane URL must be a postgres:// connection string");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new CatalogLaneError(
      `Catalog lane URL rejects ${url.protocol}; real PostgreSQL is required`,
    );
  }
  return url;
}

export function databaseNameFromUrl(url: URL): string {
  return url.pathname.replace(/^\//, "").split("/")[0] ?? "";
}

export function forbiddenCatalogLaneReason(connectionString: string): string | null {
  const url = parsePostgresUrl(connectionString);
  const port = url.port === "" ? 5432 : Number(url.port);
  const database = databaseNameFromUrl(url);

  if (port === COMPOSE_APP_PORT && (database === COMPOSE_APP_DATABASE || database === "")) {
    return (
      `Catalog launch lanes must not use the default compose app database ` +
      `postgres://…@${url.hostname}:${COMPOSE_APP_PORT}/${COMPOSE_APP_DATABASE} ` +
      `(postgres:16-alpine, shared, often without pgvector). Use the dedicated ` +
      `pgvector lane server on ${DEFAULT_LANE_HOST}:${DEFAULT_LANE_PORT} and ` +
      `wiseeff_lane_<issue>.`
    );
  }

  if (database === COMPOSE_APP_DATABASE) {
    return (
      `Catalog launch lanes must not reuse the shared database name "${COMPOSE_APP_DATABASE}". ` +
      `Provision wiseeff_lane_<issue> on the dedicated pgvector server.`
    );
  }

  return null;
}

export function assertCatalogLaneEvidenceUrl(connectionString: string): URL {
  const url = parsePostgresUrl(connectionString);
  const reason = forbiddenCatalogLaneReason(connectionString);
  if (reason) {
    throw new CatalogLaneError(reason);
  }
  return url;
}

export function parseCatalogLaneArgs(argv: string[]): CatalogLaneArgs {
  const [commandRaw, ...rest] = argv;
  const command = (commandRaw ?? "help") as CatalogLaneCommand;
  if (!["doctor", "provision", "accept", "cleanup", "help"].includes(command)) {
    throw new CatalogLaneError(
      `Unknown catalog-lane command "${commandRaw}". Use doctor, provision, accept, cleanup, or help.`,
    );
  }

  let issue: number | null = null;
  let reset = false;
  let abandoned = false;
  let databaseUrl: string | null = null;
  const commandArgv: string[] = [];
  let passthrough = false;

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (passthrough) {
      commandArgv.push(token);
      continue;
    }
    if (token === "--") {
      passthrough = true;
      continue;
    }
    if (token === "--reset") {
      reset = true;
      continue;
    }
    if (token === "--abandoned") {
      abandoned = true;
      continue;
    }
    if (token === "--issue") {
      const value = rest[i + 1];
      i += 1;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new CatalogLaneError(`--issue requires a positive integer, got ${value ?? "(missing)"}`);
      }
      issue = parsed;
      continue;
    }
    if (token === "--database-url") {
      databaseUrl = rest[i + 1] ?? "";
      i += 1;
      continue;
    }
    throw new CatalogLaneError(`Unknown catalog-lane flag "${token}"`);
  }

  return { command, issue, reset, abandoned, commandArgv, databaseUrl };
}

export function classifyFocusedTestOutput(output: string, exitCode: number): {
  ok: boolean;
  reason?: string;
} {
  if (/No test files found/i.test(output) || /no tests found/i.test(output)) {
    return {
      ok: false,
      reason:
        "Focused catalog acceptance collected zero test files. This is usually a globalSetup crash or a wrong path, not an empty suite.",
    };
  }
  if (exitCode !== 0) {
    return { ok: false, reason: `Focused catalog acceptance exited ${exitCode}` };
  }
  return { ok: true };
}

export function isAbandonedCatalogDatabase(name: string): boolean {
  return (
    REPAIR_DATABASE_PATTERN.test(name) ||
    HARNESS_DATABASE_PATTERN.test(name) ||
    /^wiseeff_lane_\d+$/.test(name)
  );
}

function usage(): string {
  return `Catalog launch-lane PostgreSQL helper.

Commands:
  doctor [--issue N | --database-url URL]
  provision --issue N [--reset]
  accept --issue N -- <issue-named command>
  cleanup --issue N | --abandoned

The default compose app database postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff
is forbidden as catalog-lane evidence. Lanes use pgvector on ${DEFAULT_LANE_HOST}:${DEFAULT_LANE_PORT}.
`;
}

async function withClient<T>(
  connectionString: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensureLaneServer(): Promise<void> {
  const inspect = await runProcess("docker", [
    "inspect",
    "-f",
    "{{.State.Running}}",
    DEFAULT_LANE_CONTAINER,
  ]);
  if (inspect.exitCode === 0 && inspect.stdout.trim() === "true") {
    return;
  }
  if (inspect.exitCode === 0 && inspect.stdout.trim() === "false") {
    const start = await runProcess("docker", ["start", DEFAULT_LANE_CONTAINER]);
    if (start.exitCode !== 0) {
      throw new CatalogLaneError(
        `Failed to start ${DEFAULT_LANE_CONTAINER}: ${start.stderr || start.stdout}`,
      );
    }
    await waitForPostgres(defaultLaneAdminUrl());
    return;
  }

  const run = await runProcess("docker", [
    "run",
    "-d",
    "--name",
    DEFAULT_LANE_CONTAINER,
    "-e",
    `POSTGRES_USER=${DEFAULT_LANE_USER}`,
    "-e",
    `POSTGRES_PASSWORD=${DEFAULT_LANE_PASSWORD}`,
    "-e",
    "POSTGRES_DB=postgres",
    "-p",
    `${DEFAULT_LANE_HOST}:${DEFAULT_LANE_PORT}:5432`,
    DEFAULT_LANE_IMAGE,
  ]);
  if (run.exitCode !== 0) {
    throw new CatalogLaneError(
      `Failed to create ${DEFAULT_LANE_CONTAINER}: ${run.stderr || run.stdout}`,
    );
  }
  await waitForPostgres(defaultLaneAdminUrl());
}

async function waitForPostgres(connectionString: string, attempts = 30): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await withClient(connectionString, async (client) => {
        await client.query("select 1");
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new CatalogLaneError(
    `Catalog lane PostgreSQL did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function requirePgvector(connectionString: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    const available = await client.query<{ default_version: string }>(
      `select default_version from pg_catalog.pg_available_extensions where name = 'vector'`,
    );
    if (!available.rows[0]?.default_version) {
      throw new CatalogLaneError(
        "Catalog lane server must offer pgvector (extension vector). postgres:16-alpine on :5432 is not valid catalog evidence.",
      );
    }
  });
}

export async function runRoleCanary(connectionString: string): Promise<{
  ran: boolean;
  detail: string;
}> {
  return withClient(connectionString, async (client) => {
    const role = await client.query<{ exists: boolean }>(
      `select exists(select 1 from pg_roles where rolname = $1) as exists`,
      [CATALOG_MIGRATION_OWNER_ROLE],
    );
    if (!role.rows[0]?.exists) {
      return {
        ran: false,
        detail: `${CATALOG_MIGRATION_OWNER_ROLE} is not present; skip role canary until 0138+ migrations apply`,
      };
    }

    const table = await client.query<{ exists: boolean }>(
      `select exists(
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'parameter_specs'
       ) as exists`,
    );
    if (!table.rows[0]?.exists) {
      return {
        ran: false,
        detail: "public.parameter_specs is not present; skip role canary until migrations apply",
      };
    }

    await client.query(`set role ${CATALOG_MIGRATION_OWNER_ROLE}`);
    try {
      await client.query(ROLE_CANARY_SQL);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CatalogLaneError(
        `Role canary failed as ${CATALOG_MIGRATION_OWNER_ROLE}: ${message}. ` +
          `Hosted will fail the same way; grant the DEFINER owner SELECT on public source tables before opening a PR.`,
      );
    } finally {
      await client.query("reset role").catch(() => undefined);
    }
    return {
      ran: true,
      detail: `${CATALOG_MIGRATION_OWNER_ROLE} can execute the public.parameter_specs canary`,
    };
  });
}

async function listDatabases(adminUrl: string): Promise<string[]> {
  return withClient(adminUrl, async (client) => {
    const result = await client.query<{ datname: string }>(
      `select datname from pg_database where datallowconn order by datname`,
    );
    return result.rows.map((row) => row.datname);
  });
}

async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  await withClient(adminUrl, async (client) => {
    await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [name],
    );
    await client.query(`drop database if exists ${quoteIdent(name)}`);
  });
}

async function createDatabase(adminUrl: string, name: string): Promise<void> {
  await withClient(adminUrl, async (client) => {
    const existing = await client.query<{ exists: boolean }>(
      `select exists(select 1 from pg_database where datname = $1) as exists`,
      [name],
    );
    if (existing.rows[0]?.exists) {
      return;
    }
    await client.query(`create database ${quoteIdent(name)} owner ${quoteIdent(DEFAULT_LANE_USER)}`);
  });
}

function quoteIdent(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new CatalogLaneError(`Unsafe PostgreSQL identifier: ${value}`);
  }
  return value;
}

async function migrateLane(databaseUrl: string): Promise<void> {
  const result = await runProcess("npx", ["tsx", "scripts/migrate.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  if (result.exitCode !== 0) {
    throw new CatalogLaneError(`db:migrate failed:\n${result.stderr || result.stdout}`);
  }
}

async function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; inherit?: boolean } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

async function doctor(args: CatalogLaneArgs): Promise<string> {
  const url = args.databaseUrl
    ? args.databaseUrl
    : args.issue
      ? connectionStringFor(laneDatabaseName(args.issue))
      : process.env.TEST_DATABASE_URL?.trim() ||
        process.env.DATABASE_URL?.trim() ||
        defaultLaneAdminUrl();

  if (args.issue || args.databaseUrl || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL) {
    if (databaseNameFromUrl(parsePostgresUrl(url)) !== DEFAULT_LANE_ADMIN_DATABASE) {
      assertCatalogLaneEvidenceUrl(url);
    }
  }

  await requirePgvector(url);
  const canary = await runRoleCanary(url).catch(async (error) => {
    if (error instanceof CatalogLaneError) {
      throw error;
    }
    return { ran: false, detail: `role canary skipped: ${String(error)}` };
  });
  return `Catalog lane doctor passed for ${url.replace(/:[^:@/]+@/, ":***@")}\n${canary.detail}`;
}

async function provision(args: CatalogLaneArgs): Promise<string> {
  if (args.issue == null) {
    throw new CatalogLaneError("provision requires --issue");
  }
  const name = laneDatabaseName(args.issue);
  const adminUrl = defaultLaneAdminUrl();
  const laneUrl = connectionStringFor(name);
  assertCatalogLaneEvidenceUrl(laneUrl);
  await ensureLaneServer();
  await requirePgvector(adminUrl);
  if (args.reset) {
    await dropDatabase(adminUrl, name);
  }
  await createDatabase(adminUrl, name);
  await migrateLane(laneUrl);
  const canary = await runRoleCanary(laneUrl);
  return [
    `Provisioned ${name} on ${DEFAULT_LANE_HOST}:${DEFAULT_LANE_PORT}`,
    `export DATABASE_URL=${laneUrl}`,
    `export TEST_DATABASE_URL=${laneUrl}`,
    canary.detail,
  ].join("\n");
}

async function cleanup(args: CatalogLaneArgs): Promise<string> {
  const adminUrl = defaultLaneAdminUrl();
  await ensureLaneServer();
  const names = await listDatabases(adminUrl);
  const dropped: string[] = [];

  if (args.issue != null) {
    const name = laneDatabaseName(args.issue);
    if (names.includes(name)) {
      await dropDatabase(adminUrl, name);
      dropped.push(name);
    }
  }

  if (args.abandoned) {
    for (const name of names) {
      if (!isAbandonedCatalogDatabase(name)) {
        continue;
      }
      if (args.issue != null && name === laneDatabaseName(args.issue)) {
        continue;
      }
      await dropDatabase(adminUrl, name);
      dropped.push(name);
    }
  }

  if (dropped.length === 0) {
    return "No catalog-lane databases dropped.";
  }
  return `Dropped: ${dropped.join(", ")}`;
}

async function accept(args: CatalogLaneArgs): Promise<string> {
  if (args.issue == null) {
    throw new CatalogLaneError("accept requires --issue");
  }
  if (args.commandArgv.length === 0) {
    throw new CatalogLaneError(
      "accept requires the Issue-named command after --, for example: npm run catalog:lane:accept -- --issue 687 -- npm run test:server -- server/modules/catalog-kernel/compiler",
    );
  }
  const provisioned = await provision({ ...args, reset: args.reset });
  const laneUrl = connectionStringFor(laneDatabaseName(args.issue));
  const doctorResult = await doctor({ ...args, databaseUrl: laneUrl });
  const command = args.commandArgv[0];
  const commandArgs = args.commandArgv.slice(1);
  const result = await runProcess(command, commandArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: laneUrl,
      TEST_DATABASE_URL: laneUrl,
    },
  });
  const combined = `${result.stdout}\n${result.stderr}`;
  const classified = classifyFocusedTestOutput(combined, result.exitCode);
  if (!classified.ok) {
    throw new CatalogLaneError(
      `${classified.reason}\n${combined.slice(-4000)}`,
    );
  }
  return [provisioned, doctorResult, combined.trim()].filter(Boolean).join("\n\n");
}

export async function runCatalogLane(argv: string[]): Promise<string> {
  const args = parseCatalogLaneArgs(argv);
  switch (args.command) {
    case "help":
      return usage();
    case "doctor":
      return doctor(args);
    case "provision":
      return provision(args);
    case "accept":
      return accept(args);
    case "cleanup":
      return cleanup(args);
    default:
      throw new CatalogLaneError(`Unhandled command ${args.command}`);
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runCatalogLane(process.argv.slice(2))
    .then((output) => {
      process.stdout.write(`${output}\n`);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
