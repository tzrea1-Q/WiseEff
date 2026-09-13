import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { runInspectCatalogPublicationBaseline } from "./inspect-catalog-publication-baseline";
import {
  adoptPreexistingCatalog,
  checkAdoptPreexistingCatalog,
  setPublicationFreeze,
  type AdoptPreexistingCatalogInput,
  type AdoptionEvidenceKind,
} from "../server/modules/catalog-publication/runtime/index";
import {
  publicationManagerDatabaseUrlReusesApiLogin,
  resolvePublicationManagerDatabaseUrl,
} from "../server/modules/catalog-publication/runtime/managerDatabaseUrl";
import {
  inspectLoginBoundary,
  provisionPublicationRuntimeLogins,
} from "../server/modules/catalog-publication/runtime/provisionRuntimeLogins";
import { writeRuntimeLoginSecrets } from "../server/modules/catalog-publication/runtime/runtimeLoginSecrets";
import { revisePublicationPolicy } from "../server/modules/catalog-publication/authorization/policy";
import { EPHEMERAL_POLICY_REVISION_CONFIRMATION } from "../server/modules/catalog-publication/authorization/types";
import { createUserInvocation } from "../server/modules/auth/trustedInvocation";
import { getAuthContext } from "../server/modules/auth/repository";
import { createPostgresDatabase, getRootPostgresPool } from "../server/shared/database/client";
import { asQueryable } from "../server/modules/catalog-kernel/install/publicationActivation";
import { CATALOG_CAPABILITY_CONTRACT_REVISION } from "../server/modules/catalog-publication/builder/types";
import {
  CatalogReleaseDigest,
  CatalogReleaseId,
} from "../server/modules/parameter-catalog-contract/index";

const CATALOG_CAPABILITIES = [
  "catalog:author",
  "catalog:publish",
  "catalog:review-high-risk",
] as const;

export type CatalogPublicationOpsCommand =
  | { readonly name: "inspect" }
  | {
      readonly name: "adopt";
      readonly mode: "check" | "execute";
      readonly expectedId: string;
      readonly expectedDigest: string;
      readonly bundlePath: string;
      readonly actor: string;
      readonly evidenceKind: AdoptionEvidenceKind;
      readonly verificationDigest: string;
      readonly dataMode: "fresh" | "populated" | "restored";
    }
  | {
      readonly name: "capabilities";
      readonly action: "grant" | "revoke" | "status";
      readonly userId: string;
      readonly organizationId: string;
      readonly capability: (typeof CATALOG_CAPABILITIES)[number];
    }
  | {
      readonly name: "policy";
      readonly action: "status" | "enable" | "disable";
      readonly actor: string;
      readonly confirmation?: string;
    }
  | {
      readonly name: "freeze";
      readonly action: "status" | "set" | "clear";
      readonly actor: string;
    }
  | {
      readonly name: "provision-logins";
      readonly mode: "official" | "lab";
      readonly runToken?: string;
      readonly rotatePasswords: boolean;
      readonly credentialDir?: string;
    }
  | { readonly name: "inspect-login"; readonly which: "api" | "worker" | "manager" };

const usage = `Usage:
  npx tsx scripts/catalog-publication-ops.ts inspect
  npx tsx scripts/catalog-publication-ops.ts adopt --check|--execute --expected-id <id> --expected-digest sha256:... --bundle <file> --actor <userId> --verification-digest sha256:... --data-mode fresh|populated|restored [--evidence-kind synthetic-fixture]
  npx tsx scripts/catalog-publication-ops.ts capabilities grant|revoke|status --user-id <id> --organization-id <id> --capability catalog:author|catalog:publish|catalog:review-high-risk
  npx tsx scripts/catalog-publication-ops.ts policy status|enable|disable --actor <userId>
  npx tsx scripts/catalog-publication-ops.ts freeze status|set|clear --actor <userId>
  npx tsx scripts/catalog-publication-ops.ts provision-logins [--mode official|lab] [--run-token TOKEN] [--rotate-passwords] [--credential-dir DIR]
  npx tsx scripts/catalog-publication-ops.ts inspect-login api|worker|manager

inspect reads CATALOG_BASELINE_READONLY_DATABASE_URL only.
adopt/capabilities/policy/freeze/provision use dedicated DSNs. Manager commands refuse DATABASE_URL reuse.
provision-logins uses WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL (superuser, one-shot).
Credentials are written to --credential-dir or WISEEFF_PUBLICATION_CREDENTIAL_DIR; stdout has no DSNs.
policy enable requires an ephemeral database name and EPHEMERAL_POLICY_REVISION_CONFIRMATION; it is not production enablement.
`;

const flag = (argv: string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
};

const has = (argv: string[], name: string): boolean => argv.includes(name);

export const parseCatalogPublicationOpsArgv = (
  argv: string[],
): { ok: true; command: CatalogPublicationOpsCommand } | { ok: false; message: string } => {
  const [command, sub] = argv;
  if (!command || command === "--help" || command === "-h") {
    return { ok: false, message: usage };
  }
  if (command === "inspect") {
    return { ok: true, command: { name: "inspect" } };
  }
  if (command === "adopt") {
    const mode = has(argv, "--execute") ? "execute" : has(argv, "--check") ? "check" : undefined;
    const expectedId = flag(argv, "--expected-id");
    const expectedDigest = flag(argv, "--expected-digest");
    const bundlePath = flag(argv, "--bundle");
    const actor = flag(argv, "--actor");
    const verificationDigest = flag(argv, "--verification-digest");
    const dataMode = flag(argv, "--data-mode") as "fresh" | "populated" | "restored" | undefined;
    const evidenceKind = (flag(argv, "--evidence-kind") ?? "synthetic-fixture") as AdoptionEvidenceKind;
    if (!mode || !expectedId || !expectedDigest || !bundlePath || !actor || !verificationDigest || !dataMode) {
      return { ok: false, message: usage };
    }
    if (dataMode !== "fresh" && dataMode !== "populated" && dataMode !== "restored") {
      return { ok: false, message: "adopt --data-mode must be fresh, populated, or restored" };
    }
    if (evidenceKind !== "synthetic-fixture" && evidenceKind !== "target-host") {
      return { ok: false, message: "adopt --evidence-kind must be synthetic-fixture or target-host" };
    }
    return {
      ok: true,
      command: {
        name: "adopt",
        mode,
        expectedId,
        expectedDigest,
        bundlePath,
        actor,
        evidenceKind,
        verificationDigest,
        dataMode,
      },
    };
  }
  if (command === "capabilities") {
    if (sub !== "grant" && sub !== "revoke" && sub !== "status") {
      return { ok: false, message: usage };
    }
    const userId = flag(argv, "--user-id");
    const organizationId = flag(argv, "--organization-id");
    const capability = flag(argv, "--capability") as (typeof CATALOG_CAPABILITIES)[number] | undefined;
    if (!userId || !organizationId || !capability || !CATALOG_CAPABILITIES.includes(capability)) {
      return { ok: false, message: usage };
    }
    return { ok: true, command: { name: "capabilities", action: sub, userId, organizationId, capability } };
  }
  if (command === "policy") {
    if (sub !== "status" && sub !== "enable" && sub !== "disable") {
      return { ok: false, message: usage };
    }
    const actor = flag(argv, "--actor") ?? "";
    if (sub !== "status" && !actor) {
      return { ok: false, message: "policy enable/disable requires --actor" };
    }
    return {
      ok: true,
      command: {
        name: "policy",
        action: sub,
        actor,
        confirmation: flag(argv, "--confirmation"),
      },
    };
  }
  if (command === "freeze") {
    if (sub !== "status" && sub !== "set" && sub !== "clear") {
      return { ok: false, message: usage };
    }
    const actor = flag(argv, "--actor") ?? process.env.WISEEFF_UPGRADE_ACTOR_PRINCIPAL_ID ?? "";
    if (sub !== "status" && !actor) {
      return { ok: false, message: "freeze set/clear requires --actor or WISEEFF_UPGRADE_ACTOR_PRINCIPAL_ID" };
    }
    return { ok: true, command: { name: "freeze", action: sub, actor } };
  }
  if (command === "provision-logins") {
    const mode = (flag(argv, "--mode") ?? "official") as "official" | "lab";
    if (mode !== "official" && mode !== "lab") {
      return { ok: false, message: usage };
    }
    return {
      ok: true,
      command: {
        name: "provision-logins",
        mode,
        runToken: flag(argv, "--run-token"),
        rotatePasswords: has(argv, "--rotate-passwords"),
        credentialDir: flag(argv, "--credential-dir") ?? process.env.WISEEFF_PUBLICATION_CREDENTIAL_DIR,
      },
    };
  }
  if (command === "inspect-login") {
    if (sub !== "api" && sub !== "worker" && sub !== "manager") {
      return { ok: false, message: usage };
    }
    return { ok: true, command: { name: "inspect-login", which: sub } };
  }
  return { ok: false, message: usage };
};

const managerPool = (): pg.Pool => {
  if (process.env.WISEEFF_API_PROCESS === "1") {
    throw new Error("catalog-publication-ops adopt/freeze must not run inside the API process identity");
  }
  const resolved = resolvePublicationManagerDatabaseUrl(process.env);
  if (!resolved.ok) {
    throw new Error(resolved.error.message);
  }
  return new pg.Pool({ connectionString: resolved.url });
};

const roleIdFor = (capability: string): string => `catalog-capability-${capability.replace(/:/g, "-")}`;

const adoptInput = (command: Extract<CatalogPublicationOpsCommand, { name: "adopt" }>): AdoptPreexistingCatalogInput => {
  const sourceBytes = Buffer.from(readFileSync(command.bundlePath, "utf8"), "utf8");
  return {
    expectedCurrent: {
      id: CatalogReleaseId(command.expectedId),
      digest: CatalogReleaseDigest(command.expectedDigest),
    },
    actorPrincipalId: command.actor,
    sourceBytes,
    artifactDigest: CatalogReleaseDigest(command.expectedDigest),
    evidenceKind: command.evidenceKind,
    adoptionEvidence: {
      source_bundle_digest: command.expectedDigest,
      verification_digest: command.verificationDigest,
      data_mode: command.dataMode,
      collected_at: new Date().toISOString(),
      approved_by: command.actor,
    },
  };
};

export const runCatalogPublicationOps = async (
  command: CatalogPublicationOpsCommand,
): Promise<{ readonly exitCode: number; readonly payload: unknown }> => {
  if (command.name === "inspect") {
    const result = await runInspectCatalogPublicationBaseline();
    if (!result.ok) {
      return { exitCode: result.error.kind === "usage" ? 2 : 1, payload: result.error };
    }
    return { exitCode: 0, payload: result.evidence };
  }

  if (command.name === "adopt") {
    const pool = managerPool();
    try {
      const input = adoptInput(command);
      if (command.mode === "check") {
        const checked = await checkAdoptPreexistingCatalog(pool, input);
        return { exitCode: checked.ok ? 0 : 1, payload: checked };
      }
      const executed = await adoptPreexistingCatalog(pool, input);
      return { exitCode: executed.ok ? 0 : 1, payload: executed };
    } finally {
      await pool.end();
    }
  }

  if (command.name === "capabilities") {
    const pool = managerPool();
    const client = await pool.connect();
    try {
      const roleId = roleIdFor(command.capability);
      if (command.action === "status") {
        const bound = await client.query<{ role_id: string }>(
          `select role_id from user_role_bindings
            where user_id = $1 and organization_id = $2 and role_id = $3`,
          [command.userId, command.organizationId, roleId],
        );
        return {
          exitCode: 0,
          payload: { granted: bound.rows.length > 0, userId: command.userId, capability: command.capability },
        };
      }
      if (command.action === "grant") {
        await client.query("begin");
        await client.query(
          `insert into roles (id, name, level, permissions)
           values ($1, $2, 'user', $3::text[])
           on conflict (id) do update set permissions = excluded.permissions`,
          [roleId, `Catalog ${command.capability}`, [command.capability, "parameter:view"]],
        );
        await client.query(
          `insert into user_role_bindings (id, user_id, organization_id, role_id)
           values ($1, $2, $3, $4)
           on conflict (id) do nothing`,
          [`${roleId}:${command.organizationId}:${command.userId}`, command.userId, command.organizationId, roleId],
        );
        await client.query("commit");
        return { exitCode: 0, payload: { granted: true, userId: command.userId, capability: command.capability } };
      }
      await client.query(
        `delete from user_role_bindings
          where user_id = $1 and organization_id = $2 and role_id = $3`,
        [command.userId, command.organizationId, roleId],
      );
      return { exitCode: 0, payload: { granted: false, userId: command.userId, capability: command.capability } };
    } finally {
      client.release();
      await pool.end();
    }
  }

  if (command.name === "provision-logins") {
    const bootstrap = process.env.WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL?.trim();
    if (!bootstrap) {
      return {
        exitCode: 2,
        payload: { message: "WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL is required for one-shot LOGIN provisioning" },
      };
    }
    const provisioned = await provisionPublicationRuntimeLogins(bootstrap, {
      mode: command.mode,
      runToken: command.runToken,
      rotatePasswords: command.rotatePasswords,
    });
    if (!provisioned.passwordsDelivered) {
      return {
        exitCode: 0,
        payload: {
          database: provisioned.database,
          apiRole: provisioned.apiRole,
          workerRole: provisioned.workerRole,
          managerRole: provisioned.managerRole,
          passwordsDelivered: false,
          reused: provisioned.reused,
          message: "existing owned LOGINs were verified; passwords were not rotated",
        },
      };
    }
    if (!command.credentialDir) {
      return {
        exitCode: 2,
        payload: {
          message: "WISEEFF_PUBLICATION_CREDENTIAL_DIR or --credential-dir is required; DSNs are not printed",
        },
      };
    }
    const files = writeRuntimeLoginSecrets({
      directory: command.credentialDir,
      apiUrl: provisioned.apiUrl,
      workerUrl: provisioned.workerUrl,
      managerUrl: provisioned.managerUrl,
      overwrite: command.rotatePasswords,
    });
    return {
      exitCode: 0,
      payload: {
        database: provisioned.database,
        apiRole: provisioned.apiRole,
        workerRole: provisioned.workerRole,
        managerRole: provisioned.managerRole,
        passwordsDelivered: true,
        created: provisioned.created,
        reused: provisioned.reused,
        credentialDir: files.directory,
        files: { api: files.api, worker: files.worker, manager: files.manager },
      },
    };
  }

  if (command.name === "inspect-login") {
    if (command.which === "manager") {
      const resolved = resolvePublicationManagerDatabaseUrl(process.env);
      if (!resolved.ok) {
        return { exitCode: 2, payload: resolved.error };
      }
      const boundary = await inspectLoginBoundary(resolved.url);
      return { exitCode: 0, payload: boundary };
    }
    if (command.which === "worker") {
      const workerUrl = process.env.WISEEFF_WORKER_DATABASE_URL?.trim() ?? "";
      const apiUrl = process.env.DATABASE_URL?.trim() ?? "";
      if (!workerUrl) {
        return {
          exitCode: 2,
          payload: { message: "WISEEFF_WORKER_DATABASE_URL is required; do not reuse DATABASE_URL" },
        };
      }
      if (apiUrl && publicationManagerDatabaseUrlReusesApiLogin(workerUrl, apiUrl)) {
        return {
          exitCode: 2,
          payload: { message: "WISEEFF_WORKER_DATABASE_URL must not reuse the API DATABASE_URL login" },
        };
      }
      const boundary = await inspectLoginBoundary(workerUrl);
      return { exitCode: 0, payload: boundary };
    }
    const apiUrl = process.env.DATABASE_URL?.trim();
    if (!apiUrl) {
      return { exitCode: 2, payload: { message: "DATABASE_URL is required" } };
    }
    const boundary = await inspectLoginBoundary(apiUrl);
    return { exitCode: 0, payload: boundary };
  }

  if (command.name === "policy") {
    const url =
      command.action === "status"
        ? (() => {
            const resolved = resolvePublicationManagerDatabaseUrl(process.env);
            return resolved.ok ? resolved.url : process.env.WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL?.trim();
          })()
        : process.env.WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL?.trim();
    if (!url) {
      return {
        exitCode: 2,
        payload: {
          message:
            command.action === "status"
              ? "manager or bootstrap DSN is required"
              : "WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL is required to revise policy",
        },
      };
    }
    const db = createPostgresDatabase(url);
    try {
      if (command.action === "status") {
        const policy = await db.query<{
          publication_enabled: boolean;
          low_risk_single_actor_publish: boolean;
        }>(`select publication_enabled, low_risk_single_actor_publish from catalog_publication.publication_policies where singleton`);
        return { exitCode: 0, payload: policy.rows[0] ?? null };
      }
      if (command.confirmation !== EPHEMERAL_POLICY_REVISION_CONFIRMATION) {
        return {
          exitCode: 3,
          payload: {
            message: "policy enable/disable is isolated-only; pass --confirmation matching EPHEMERAL_POLICY_REVISION_CONFIRMATION",
          },
        };
      }
      const actor = await getAuthContext(db, command.actor);
      const revised = await revisePublicationPolicy(db, {
        trustedActor: createUserInvocation(actor),
        publicationEnabled: command.action === "enable",
        lowRiskSingleActorPublish: command.action === "enable",
        capabilityContractRevision: CATALOG_CAPABILITY_CONTRACT_REVISION,
        isolatedInstanceConfirmation: EPHEMERAL_POLICY_REVISION_CONFIRMATION,
      });
      return { exitCode: revised.ok ? 0 : 1, payload: revised };
    } finally {
      await db.close();
    }
  }

  const resolved = resolvePublicationManagerDatabaseUrl(process.env);
  if (!resolved.ok) {
    return { exitCode: 2, payload: resolved.error };
  }
  const url = resolved.url;
  const db = createPostgresDatabase(url);
  const pool = getRootPostgresPool(db);
  try {
    if (command.action === "status") {
      const freeze = await db.query<{ frozen: boolean }>(
        `select frozen from catalog_publication.publication_freeze where singleton`,
      );
      return { exitCode: 0, payload: freeze.rows[0] ?? null };
    }
    if (!pool) {
      return { exitCode: 1, payload: { message: "root pool required" } };
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role catalog_publication_coordinator_role");
      const result = await setPublicationFreeze(asQueryable(client), {
        frozen: command.action === "set",
        actorPrincipalId: command.actor,
      });
      if (!result.ok) {
        await client.query("rollback");
        return { exitCode: 1, payload: result };
      }
      await client.query("commit");
      return { exitCode: 0, payload: result };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await db.close();
  }
};

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const parsed = parseCatalogPublicationOpsArgv(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n`);
    process.exitCode = 2;
  } else {
    runCatalogPublicationOps(parsed.command)
      .then((result) => {
        process.stdout.write(`${JSON.stringify(result.payload)}\n`);
        process.exitCode = result.exitCode;
      })
      .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      });
  }
}
