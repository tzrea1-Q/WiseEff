import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { hashLocalAccountPassword } from "../server/modules/auth/localAccountCredentials";
import { getAuthContext } from "../server/modules/auth/repository";
import { createUserInvocation } from "../server/modules/auth/trustedInvocation";
import { seedM0Foundation } from "./seed-m0";
import { EPHEMERAL_POLICY_REVISION_CONFIRMATION } from "../server/modules/catalog-publication/authorization/types";
import { CATALOG_CAPABILITY_CONTRACT_REVISION } from "../server/modules/catalog-publication/builder/types";
import { revisePublicationPolicy } from "../server/modules/catalog-publication/authorization/policy";
import {
  adoptPreexistingCatalog,
  checkAdoptPreexistingCatalog,
} from "../server/modules/catalog-publication/runtime/adoption";
import {
  dropLabRuntimeLogins,
  inspectLoginBoundary,
  provisionPublicationRuntimeLogins,
} from "../server/modules/catalog-publication/runtime/provisionRuntimeLogins";
import { createPostgresDatabase } from "../server/shared/database/client";
import { isForbiddenComposeAppPostgres } from "../ops/self-hosted/storage/recoveryPoint";
import { createEphemeralTestDatabase } from "../server/testing/testDatabase";
import {
  CHARGER_SUBJECT_ID,
  installPublishedCatalogMatchChain,
  retiredPowerSubjectSuccessorBundle,
} from "../server/modules/catalog-kernel/runtime/catalogChain.fixture";
import { compileCatalogRelease } from "../server/modules/catalog-kernel/compiler/index";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DELIVERY_PUBLISHER = {
  userId: "acceptance-role-admin",
  name: "Acceptance Admin",
  email: "acceptance.admin@chargelab.cn",
  username: "ra04.publisher",
  organizationId: "org-chargelab",
  projectId: "aurora",
} as const;

export type DeliveryLabEvidence = {
  readonly sha: string;
  readonly image: string;
  readonly imageId: string;
  readonly database: string;
  readonly apiRole: string;
  readonly workerRole: string;
  readonly managerRole: string;
  readonly apiSuperuser: false;
  readonly workerSuperuser: false;
  readonly managerSuperuser: false;
  readonly publisherUserId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly adoptedReleaseId: string;
  readonly adoptedDigest: string;
  readonly adoptReceiptKind: string;
  readonly subjectId: string;
  readonly apiOrigin: string;
  readonly frontendOrigin: string;
  readonly loginUsername: string;
  readonly composeProject: string;
};

const fail = (message: string, code = 2): never => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

const run = (command: string, args: string[], env: NodeJS.ProcessEnv, cwd = repoRoot) => {
  const result = spawnSync(command, args, { encoding: "utf8", cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  return result;
};

export function rewriteDatabaseHost(url: string, hostname: string): string {
  const parsed = new URL(url);
  parsed.hostname = hostname;
  return parsed.toString();
}

export function assertIsolatedPostgresUrl(url: string, label: string): void {
  if (isForbiddenComposeAppPostgres(url)) {
    throw new Error(`${label} must not use the shared compose app database 127.0.0.1:5432/wiseeff.`);
  }
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = Number(parsed.port || "5432");
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "localhost", "[::1]", "host.docker.internal"].includes(host)) {
    throw new Error(`${label} must be loopback or host.docker.internal, got ${host}`);
  }
  if (port === 5432 && database === "wiseeff") {
    throw new Error(`${label} must not target the shared compose app database.`);
  }
  if (database === "wiseeff" && port === 55438) {
    throw new Error(`${label} must not reuse the shared g668 database name wiseeff; create an ephemeral database.`);
  }
}

export function resolveBootstrapUrl(env: NodeJS.ProcessEnv): string {
  const url =
    env.WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL?.trim() ||
    env.TEST_DATABASE_URL?.trim() ||
    env.DATABASE_URL?.trim() ||
    "postgres://wiseeff:wiseeff@127.0.0.1:55438/postgres";
  assertIsolatedPostgresUrl(url, "bootstrap DATABASE_URL");
  const parsed = new URL(url);
  if (Number(parsed.port || "5432") !== 55438) {
    throw new Error("Isolated Catalog delivery requires the dedicated pgvector server on 127.0.0.1:55438.");
  }
  return url;
}

export async function preflightDeliveryLab(env: NodeJS.ProcessEnv): Promise<{
  readonly bootstrapUrl: string;
  readonly sha: string;
  readonly docker: string;
}> {
  if (env.WISEEFF_CATALOG_TEST_CAPABILITIES) {
    fail("WISEEFF_CATALOG_TEST_CAPABILITIES must be unset for delivery acceptance; grant real catalog capabilities instead.");
  }
  let bootstrapUrl: string;
  try {
    bootstrapUrl = resolveBootstrapUrl(env);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const docker = run("docker", ["version", "--format", "{{.Server.Version}}"], env);
  if (docker.status !== 0) {
    fail(`docker is required to build the formal image: ${docker.stderr || docker.stdout}`, 1);
  }
  const git = run("git", ["rev-parse", "HEAD"], env);
  if (git.status !== 0 || !git.stdout.trim()) {
    fail("git rev-parse HEAD failed", 1);
  }
  const probe = new pg.Client({ connectionString: bootstrapUrl, connectionTimeoutMillis: 4000 });
  try {
    await probe.connect();
    const vector = await probe.query<{ installed: boolean }>(
      `select exists (select 1 from pg_catalog.pg_extension where extname = 'vector') as installed`,
    );
    if (vector.rows[0]?.installed !== true) {
      fail("Isolated Catalog delivery requires pgvector on 127.0.0.1:55438.", 1);
    }
    const superuser = await probe.query<{ rolsuper: boolean }>(
      `select rolsuper from pg_roles where rolname = current_user`,
    );
    if (superuser.rows[0]?.rolsuper !== true) {
      fail("Bootstrap URL must be a superuser for one-shot LOGIN provisioning, not the API/manager identity.", 1);
    }
  } catch (error) {
    fail(`Could not connect to isolated pgvector: ${error instanceof Error ? error.message : String(error)}`, 1);
  } finally {
    await probe.end().catch(() => undefined);
  }
  return { bootstrapUrl, sha: git.stdout.trim(), docker: docker.stdout.trim() };
}

const grantCapability = async (
  client: pg.Client,
  input: { userId: string; organizationId: string; capability: string },
) => {
  const roleId = `catalog-capability-${input.capability.replace(/:/g, "-")}`;
  await client.query(
    `insert into roles (id, name, level, permissions)
     values ($1, $2, 'user', $3::text[])
     on conflict (id) do update set permissions = excluded.permissions`,
    [roleId, `Catalog ${input.capability}`, [input.capability, "parameter:view"]],
  );
  await client.query(
    `insert into user_role_bindings (id, user_id, organization_id, role_id)
     values ($1, $2, $3, $4)
     on conflict (id) do nothing`,
    [`${roleId}:${input.organizationId}:${input.userId}`, input.userId, input.organizationId, roleId],
  );
};

export async function provisionDeliveryDatabase(bootstrapUrl: string): Promise<{
  readonly databaseUrl: string;
  readonly drop: () => Promise<void>;
  readonly apiUrl: string;
  readonly workerUrl: string;
  readonly managerUrl: string;
  readonly publisherPassword: string;
  readonly adoptedReleaseId: string;
  readonly adoptedDigest: string;
  readonly adoptReceiptKind: string;
  readonly subjectId: string;
  readonly apiRole: string;
  readonly workerRole: string;
  readonly managerRole: string;
}> {
  process.env.TEST_DATABASE_URL = bootstrapUrl;
  process.env.DATABASE_URL = bootstrapUrl;
  const ephemeral = await createEphemeralTestDatabase("ra04m1");
  assertIsolatedPostgresUrl(ephemeral.url, "ephemeral delivery database");
  const runToken = ephemeral.url.replace(/[^a-z0-9]/gi, "").slice(-16).toLowerCase();
  const provisioned = await provisionPublicationRuntimeLogins(ephemeral.url, {
    mode: "lab",
    runToken,
  });
  const dropOwned = async () => {
    const cleanup = await dropLabRuntimeLogins(ephemeral.url, runToken);
    await ephemeral.drop();
    if (cleanup.failed.length > 0) {
      throw new Error(`lab LOGIN cleanup failed for ${cleanup.failed.join(",")}`);
    }
  };
  const apiBoundary = await inspectLoginBoundary(provisioned.apiUrl);
  const workerBoundary = await inspectLoginBoundary(provisioned.workerUrl);
  const managerBoundary = await inspectLoginBoundary(provisioned.managerUrl);
  if (apiBoundary.superuser || workerBoundary.superuser || managerBoundary.superuser) {
    fail("Provisioned API/worker/manager LOGINs must not be superusers.", 1);
  }
  const bootstrap = createPostgresDatabase(ephemeral.url);
  await seedM0Foundation(bootstrap);
  const publisherPassword = `Ra04-${randomBytes(12).toString("base64url")}`;
  const admin = new pg.Client({ connectionString: ephemeral.url });
  await admin.connect();
  try {
    await admin.query(
      `insert into users (id, organization_id, name, email, title, is_active)
       values ($1, $2, $3, $4, $5, true)
       on conflict (id) do update set
         organization_id = excluded.organization_id,
         name = excluded.name,
         email = excluded.email,
         title = excluded.title,
         is_active = excluded.is_active`,
      [DELIVERY_PUBLISHER.userId, DELIVERY_PUBLISHER.organizationId, DELIVERY_PUBLISHER.name, DELIVERY_PUBLISHER.email, "Org Admin"],
    );
    await admin.query(
      `insert into user_role_bindings (id, user_id, organization_id, role_id)
       values ($1, $2, $3, 'admin')
       on conflict (id) do nothing`,
      [`urb-ra04-publisher-admin`, DELIVERY_PUBLISHER.userId, DELIVERY_PUBLISHER.organizationId],
    );
    await admin.query(
      `insert into projects (id, organization_id, name, code, status)
       values ($1, $2, $3, $4, 'initialized')
       on conflict (id) do nothing`,
      [DELIVERY_PUBLISHER.projectId, DELIVERY_PUBLISHER.organizationId, "Aurora", "AURORA"],
    );
    await admin.query(
      `insert into user_password_credentials (user_id, username, password_hash)
       values ($1, $2, $3)
       on conflict (user_id) do update set
         username = excluded.username,
         password_hash = excluded.password_hash,
         password_updated_at = now()`,
      [DELIVERY_PUBLISHER.userId, DELIVERY_PUBLISHER.username, await hashLocalAccountPassword(publisherPassword)],
    );
    await grantCapability(admin, {
      userId: DELIVERY_PUBLISHER.userId,
      organizationId: DELIVERY_PUBLISHER.organizationId,
      capability: "catalog:author",
    });
    await grantCapability(admin, {
      userId: DELIVERY_PUBLISHER.userId,
      organizationId: DELIVERY_PUBLISHER.organizationId,
      capability: "catalog:publish",
    });
    for (const roleId of ["hardware-committer", "software-committer", "software-user"] as const) {
      await admin.query(
        `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do nothing`,
        [`urb-ra04-publisher-${roleId}`, DELIVERY_PUBLISHER.userId, DELIVERY_PUBLISHER.organizationId, DELIVERY_PUBLISHER.projectId, roleId],
      );
    }
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({ connectionString: ephemeral.url, max: 4 });
  let adoptedReleaseId = "";
  let adoptedDigest = "";
  let adoptReceiptKind = "";
  let subjectId = "";
  try {
    const chain = await installPublishedCatalogMatchChain(pool);
    adoptedReleaseId = chain.pinF.id;
    adoptedDigest = chain.pinF.digest;
    subjectId = CHARGER_SUBJECT_ID;
    const bundle = retiredPowerSubjectSuccessorBundle();
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) {
      fail(`delivery catalog successor failed to compile: ${JSON.stringify(compiled.error)}`, 1);
    }
    const sourceBytes = Buffer.from(JSON.stringify(bundle), "utf8");
    const fingerprint = await pool.query<{ compiled_fingerprint: string }>(
      `select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id = $1`,
      [adoptedReleaseId],
    );
    const managerPool = new pg.Pool({ connectionString: provisioned.managerUrl, max: 2 });
    try {
      const input = {
        expectedCurrent: chain.pinF,
        actorPrincipalId: DELIVERY_PUBLISHER.userId,
        sourceBytes,
        artifactDigest: chain.pinF.digest,
        evidenceKind: "synthetic-fixture" as const,
        adoptionEvidence: {
          source_bundle_digest: chain.pinF.digest,
          verification_digest: fingerprint.rows[0]?.compiled_fingerprint ?? chain.pinF.digest,
          data_mode: "fresh" as const,
          collected_at: new Date().toISOString(),
          approved_by: DELIVERY_PUBLISHER.userId,
        },
      };
      const checked = await checkAdoptPreexistingCatalog(managerPool, input);
      if (!checked.ok) {
        fail(`adopt --check failed: ${JSON.stringify(checked)}`, 1);
      }
      const executed = await adoptPreexistingCatalog(managerPool, input);
      if (!executed.ok) {
        fail(`adopt --execute failed: ${JSON.stringify(executed)}`, 1);
      }
      const receipt = await pool.query<{ kind: string }>(
        `select kind from parameter_catalog.catalog_activation_receipts order by created_at desc limit 1`,
      );
      adoptReceiptKind = receipt.rows[0]?.kind ?? "";
    } finally {
      await managerPool.end();
    }
    const actor = await getAuthContext(bootstrap, DELIVERY_PUBLISHER.userId);
    const enabled = await revisePublicationPolicy(bootstrap, {
      trustedActor: createUserInvocation(actor),
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
      capabilityContractRevision: CATALOG_CAPABILITY_CONTRACT_REVISION,
      isolatedInstanceConfirmation: EPHEMERAL_POLICY_REVISION_CONFIRMATION,
    });
    if (!enabled.ok) {
      fail(`isolated policy enable failed: ${JSON.stringify(enabled)}`, 1);
    }
  } finally {
    await pool.end();
    await bootstrap.close();
  }

  return {
    databaseUrl: ephemeral.url,
    drop: dropOwned,
    apiUrl: provisioned.apiUrl,
    workerUrl: provisioned.workerUrl,
    managerUrl: provisioned.managerUrl,
    publisherPassword,
    adoptedReleaseId,
    adoptedDigest,
    adoptReceiptKind,
    subjectId,
    apiRole: provisioned.apiRole,
    workerRole: provisioned.workerRole,
    managerRole: provisioned.managerRole,
  };
}

export function buildDeliveryImage(sha: string, apiOrigin: string, env: NodeJS.ProcessEnv): {
  readonly image: string;
  readonly imageId: string;
} {
  const tag = `ra04-${sha.slice(0, 12)}`;
  const image = `${env.WISEEFF_APP_IMAGE ?? "wiseeff-app"}:${env.WISEEFF_APP_TAG ?? tag}`;
  const existing = env.WISEEFF_DELIVERY_IMAGE?.trim();
  const target = existing || image;
  if (!existing) {
    const build = run(
      "docker",
      [
        "build",
        "-f",
        "ops/self-hosted/Dockerfile",
        "--secret",
        `id=wiseeff-corporate-ca,src=ops/self-hosted/build-network/empty-ca.pem`,
        "--build-arg",
        "VITE_WISEEFF_RUNTIME_MODE=api",
        "--build-arg",
        `VITE_WISEEFF_API_BASE_URL=${apiOrigin}`,
        "-t",
        target,
        ".",
      ],
      { ...env, DOCKER_BUILDKIT: "1" },
    );
    if (build.status !== 0) {
      process.stderr.write(build.stderr);
      process.stderr.write(build.stdout);
      fail(`formal image build failed with exit ${build.status ?? 1}`, 1);
    }
  }
  const inspect = run("docker", ["image", "inspect", "-f", "{{.Id}}", target], env);
  if (inspect.status !== 0 || !inspect.stdout.trim()) {
    fail(`docker image inspect failed for ${target}`, 1);
  }
  return { image: target, imageId: inspect.stdout.trim() };
}

export function writeDeliveryEnvFiles(input: {
  readonly dir: string;
  readonly apiUrl: string;
  readonly workerUrl: string;
  readonly managerUrl: string;
  readonly apiOrigin: string;
}): { readonly publicEnv: string; readonly managerEnv: string; readonly workerEnv: string } {
  mkdirSync(input.dir, { mode: 0o700, recursive: true });
  const minioUser = "wiseeff";
  const minioPassword = randomBytes(12).toString("hex");
  const publicEnv = path.join(input.dir, ".env");
  const managerEnv = path.join(input.dir, ".env.publication-manager");
  const workerEnv = path.join(input.dir, ".env.worker");
  const body = `NODE_ENV=production
HOST=0.0.0.0
PORT=8787
POSTGRES_PASSWORD=unused-isolated
DATABASE_URL=${input.apiUrl}
WISEEFF_WORKER_DATABASE_URL=${input.workerUrl}
AUTH_MODE=production
AUTH_PROVIDER=local
AUTH_OIDC_ISSUER=
AUTH_OIDC_AUDIENCE=
AUTH_OIDC_JWKS_URI=
M6_SELFHOSTED_SMOKE_AUTHORIZATION=
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=${input.apiOrigin}
MINIO_ROOT_USER=${minioUser}
MINIO_ROOT_PASSWORD=${minioPassword}
OBJECT_STORE_MODE=s3
OBJECT_STORAGE_ENDPOINT=http://minio:9000
OBJECT_STORAGE_BUCKET=wiseeff
OBJECT_STORAGE_ACCESS_KEY_ID=${minioUser}
OBJECT_STORAGE_SECRET_ACCESS_KEY=${minioPassword}
OBJECT_STORAGE_TLS_POLICY=insecure
OBJECT_STORAGE_PATH_STYLE=true
OBJECT_STORAGE_HEALTH_PREFIX=health/
OBJECT_STORAGE_RETENTION_CLASS=standard
BACKUP_DATABASE_TARGET=
BACKUP_OBJECT_STORAGE_TARGET=
RESTORE_DATABASE_URL=
RESTORE_OBJECT_STORAGE_BUCKET=
RESTORE_OBJECT_STORAGE_PREFIX=
DEBUG_DEVICE_GATEWAY_MODE=simulator
DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true
XIAOZE_LLM_API_BASE_URL=
XIAOZE_LLM_MODEL=
XIAOZE_LLM_API_KEY=
AGENT_API_TIMEOUT_MS=30000
XIAOZE_CHECKPOINTER=postgres
LOG_ANALYSIS_API_BASE_URL=
LOG_ANALYSIS_MODEL=
LOG_ANALYSIS_API_KEY=
LOG_ANALYSIS_API_TIMEOUT_MS=30000
LOG_ANALYSIS_TOKEN_BUDGET=8000
LOG_ANALYSIS_DETERMINISTIC=true
WISEEFF_PUBLICATION_MANAGER_ENV_FILE=.env.publication-manager
WISEEFF_CATALOG_PUBLICATION_DATA_MODE=new-empty
LOG_WORKER_ENABLED=false
LOG_ANALYSIS_QUEUE_MODE=durable
REDIS_URL=redis://redis:6379
LOG_ANALYSIS_QUEUE_PREFIX=wiseeff
LOG_ANALYSIS_QUEUE_ATTEMPTS=4
LOG_ANALYSIS_QUEUE_BACKOFF_MS=1000
LOG_ANALYSIS_QUEUE_CONCURRENCY=1
WISEEFF_API_PROCESS=1
`;
  writeFileSync(publicEnv, body, { mode: 0o600 });
  writeFileSync(
    workerEnv,
    `${body}DATABASE_URL=${input.workerUrl}\nLOG_WORKER_ENABLED=true\nWISEEFF_API_PROCESS=0\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    managerEnv,
    `WISEEFF_PUBLICATION_MANAGER=1
WISEEFF_PUBLICATION_MANAGER_DATABASE_URL=${input.managerUrl}
WISEEFF_PUBLICATION_MANAGER_LEASE_MS=30000
WISEEFF_PUBLICATION_MANAGER_RETRY_BUDGET=5
WISEEFF_PUBLICATION_MANAGER_POLL_INTERVAL_MS=1000
WISEEFF_PUBLICATION_MANAGER_ACTIVATION_TIMEOUT_MS=60000
WISEEFF_PUBLICATION_MANAGER_HEALTH_PORT=8791
WISEEFF_API_PROCESS=0
LOG_WORKER_ENABLED=false
`,
    { mode: 0o600 },
  );
  return { publicEnv, managerEnv, workerEnv };
}

export function composeArgs(input: {
  readonly project: string;
  readonly publicEnv: string;
  readonly managerEnv: string;
}): string[] {
  return [
    "compose",
    "--project-name",
    input.project,
    "--env-file",
    input.publicEnv,
    "-f",
    path.join(repoRoot, "ops/self-hosted/compose.yaml"),
    "-f",
    path.join(repoRoot, "e2e/acceptance/helpers/compose.catalog-delivery.yaml"),
  ];
}

export function sha256File(contents: string): string {
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}
