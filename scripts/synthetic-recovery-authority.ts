import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { createPostgresDatabase, type RootDatabase } from "../server/shared/database/client";
import { applyMigrations } from "../server/shared/database/migrations";
import { createLocalAuthService } from "../server/modules/auth/localAuth";
import { hashLocalAccountPassword } from "../server/modules/auth/localAccountCredentials";
import { createIsolatedUpgradeDocker } from "./isolated-upgrade-docker";
import { openDeploymentAuthority, type DeploymentAuthorityAssignment, type DeploymentAuthorityOptions } from "../ops/self-hosted/scripts/parameter-catalog-upgrade/deploymentAuthority";
import { recordRecoveryExecutionApproval } from "../ops/self-hosted/scripts/parameter-catalog-upgrade/recoveryApproval";
import { assertHostOperationLockForJournal, type HostOperationLock } from "../ops/self-hosted/scripts/parameter-catalog-upgrade/handoff";
import { canonicalJson, loadUpgradeJournal, sha256Prefixed, type RecoveryCaptureRecord, type UpgradeJournal } from "../ops/self-hosted/scripts/parameter-catalog-upgrade/journal";
import { recoveryExecutionRecordDigest, type RecoveryExecutionApproval } from "../ops/self-hosted/storage/execution/authorization";
import type { RecoveryTargetIdentity } from "../ops/self-hosted/storage/recoveryPoint";

export type SyntheticRecoveryAuthorityInput = {
  runId: string; operationRoot: string; privateDirectory: string;
  journal: UpgradeJournal; lock: HostOperationLock; capture: RecoveryCaptureRecord;
  target: RecoveryTargetIdentity; restoreToken: string;
  sourceDatabase: DeploymentAuthorityOptions["sourceDatabase"];
  auth: { expectedDaemonId: string; containerId: string; sourceContainerId: string; targetContainerId: string;
    imageId: string; networkId: string; adminUrl: string; registeredContainerIds: string[] };
};
const refuse = (): never => { throw new Error("synthetic-recovery-authority-unavailable"); };
const label = "wiseeff.synthetic-recovery-run";

/** Synthetic CLI composition only. The caller owns every Docker resource;
 * this module never creates/deletes containers or connects to ambient URLs. */
export async function openSyntheticRecoveryAuthority(input: SyntheticRecoveryAuthorityInput): Promise<{
  approval: RecoveryExecutionApproval; close(): Promise<void>;
}> {
  let journal: UpgradeJournal, lock: HostOperationLock;
  let fixed: Omit<SyntheticRecoveryAuthorityInput, "journal" | "lock">;
  try { const { journal: selectedJournal, lock: selectedLock, ...rest } = input;
    journal = selectedJournal; lock = selectedLock; fixed = structuredClone(rest); }
  catch { return refuse(); }
  let bootstrap: RootDatabase | undefined, control: RootDatabase | undefined;
  let authority: Awaited<ReturnType<typeof openDeploymentAuthority>> | undefined;
  let directoryHandle: Awaited<ReturnType<typeof open>> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => authority?.close()), Promise.resolve().then(() => control?.close()),
      Promise.resolve().then(() => bootstrap?.close()), Promise.resolve().then(() => directoryHandle?.close()),
    ]);
    if (results.some(result => result.status === "rejected")) refuse();
  })();
  try {
    if (!/^[a-f0-9]{24}$/.test(fixed.runId) || fixed.capture.runId !== fixed.runId || journal.record.runId !== fixed.runId
      || fixed.capture.source.postgresIdentity !== fixed.auth.sourceContainerId || fixed.target.postgresIdentity !== fixed.auth.targetContainerId
      || path.dirname(journal.journalPath) !== fixed.operationRoot || path.dirname(fixed.privateDirectory) !== fixed.operationRoot
      || fixed.auth.containerId === fixed.auth.sourceContainerId || fixed.auth.containerId === fixed.auth.targetContainerId
      || ![fixed.auth.containerId, fixed.auth.sourceContainerId, fixed.auth.targetContainerId, fixed.auth.networkId].every(id => /^[a-f0-9]{64}$/.test(id))
      || !/^sha256:[a-f0-9]{64}$/.test(fixed.auth.imageId)) refuse();
    await assertHostOperationLockForJournal(lock, journal.journalPath);
    const loaded = loadUpgradeJournal({ journalPath: journal.journalPath, runId: fixed.runId, requireSettled: true });
    const captureEvent = loaded.ok && loaded.value.record.entries.filter(entry => entry.recoveryCapture).at(-1);
    if (!loaded.ok || loaded.value.record.journalDigest !== journal.record.journalDigest
      || !captureEvent || captureEvent.recoveryCapture?.outcome !== "committed"
      || canonicalJson(captureEvent.recoveryCapture.capture) !== canonicalJson(fixed.capture)) refuse();
    const originalJournalDigest = journal.record.journalDigest;
    const docker = createIsolatedUpgradeDocker();
    if (docker.daemonId !== fixed.auth.expectedDaemonId) refuse();
    const url = new URL(fixed.auth.adminUrl);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1"
      || url.username !== "postgres" || !url.password || url.pathname !== "/postgres" || !url.port || url.search || url.hash) refuse();
    directoryHandle = await open(fixed.privateDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const directoryIdentity = await directoryHandle.stat();
    let storageIdentity: string | undefined;
    const check = async () => {
      await assertHostOperationLockForJournal(lock, journal.journalPath);
      const current = loadUpgradeJournal({ journalPath: journal.journalPath, runId: fixed.runId, requireSettled: true });
      if (!current.ok || current.value.record.journalDigest !== originalJournalDigest) refuse();
      const named = await lstat(fixed.privateDirectory), held = await directoryHandle!.stat();
      if (!named.isDirectory() || named.isSymbolicLink() || named.uid !== process.getuid?.() || (named.mode & 0o777) !== 0o700
        || named.dev !== directoryIdentity.dev || named.ino !== directoryIdentity.ino || held.dev !== named.dev || held.ino !== named.ino
        || await realpath(fixed.privateDirectory) !== fixed.privateDirectory) refuse();
      for (const id of [fixed.auth.sourceContainerId, fixed.auth.targetContainerId]) docker.assertOwned(id, label, fixed.runId);
      const actual = docker.assertOwned(fixed.auth.containerId, label, fixed.runId);
      const networks = Object.values(actual.NetworkSettings?.Networks ?? {}) as { NetworkID: string }[];
      const bindings = actual.NetworkSettings?.Ports?.["5432/tcp"];
      const network = JSON.parse(docker.command(["network", "inspect", fixed.auth.networkId]).toString())[0];
      if (actual.Image !== fixed.auth.imageId || !actual.State?.Running || actual.HostConfig?.Privileged
        || actual.HostConfig?.NetworkMode === "host" || networks.length !== 1 || networks[0].NetworkID !== fixed.auth.networkId
        || bindings?.length !== 1 || bindings[0].HostIp !== "127.0.0.1" || bindings[0].HostPort !== url.port
        || network.Id !== fixed.auth.networkId || network.Labels?.[label] !== fixed.runId || network.Driver !== "bridge") refuse();
      if (actual.Mounts?.length !== 1 || actual.Mounts[0].Type !== "volume" || !actual.Mounts[0].Name
        || actual.Mounts[0].Destination !== "/var/lib/postgresql/data" || actual.Mounts[0].RW !== true) refuse();
      const volume = JSON.parse(docker.command(["volume", "inspect", actual.Mounts[0].Name]).toString())[0];
      if (volume.Name !== actual.Mounts[0].Name || volume.Mountpoint !== actual.Mounts[0].Source
        || volume.Labels?.[label] !== fixed.runId || volume.Driver !== "local" || volume.Scope !== "local"
        || Object.keys(volume.Options ?? {}).length !== 0 || !Number.isFinite(Date.parse(volume.CreatedAt))) refuse();
      const consumers = docker.command(["ps", "-a", "--no-trunc", "--filter", `volume=${actual.Mounts[0].Name}`, "--format", "{{.ID}}"])
        .toString().trim().split("\n").filter(Boolean);
      if (consumers.length !== 1 || consumers[0] !== fixed.auth.containerId) refuse();
      const registered = fixed.auth.registeredContainerIds;
      if (!Array.isArray(registered) || registered.some(id => !/^[a-f0-9]{64}$/.test(id))
        || ![fixed.auth.containerId, fixed.auth.sourceContainerId, fixed.auth.targetContainerId].every(id => registered.includes(id))) refuse();
      const networkUsers = [...new Set([...Object.keys(network.Containers ?? {}), ...docker.command([
        "ps", "-a", "--no-trunc", "--filter", `network=${fixed.auth.networkId}`, "--format", "{{.ID}}",
      ]).toString().trim().split("\n").filter(Boolean)])];
      for (const id of networkUsers) {
        if (!registered.includes(id)) refuse();
        docker.assertOwned(id, label, fixed.runId);
      }
      const observedStorage = canonicalJson({ mounts: actual.Mounts, networks: actual.NetworkSettings.Networks,
        networkCreated: network.Created, volume });
      if (storageIdentity !== undefined && storageIdentity !== observedStorage) refuse();
      storageIdentity = observedStorage;
    };
    await check();
    bootstrap = createPostgresDatabase(url.href);
    // This fresh parent-owned cluster must not contain a pre-existing application.
    const empty = await bootstrap.query<{ empty: boolean }>(`select
      not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%')
      and not exists(select 1 from pg_catalog.pg_database where datname not in ('postgres','template0','template1'))
      and not exists(select 1 from pg_catalog.pg_roles where oid>=16384)
      and session_user=current_user and session_user='postgres' as empty`);
    if (empty.rows[0]?.empty !== true) refuse();
    const database = `synthetic_authority_${fixed.runId}`;
    await check();
    await bootstrap.query(`create database ${pg.escapeIdentifier(database)}`);
    const controlUrl = new URL(url); controlUrl.pathname = `/${database}`;
    control = createPostgresDatabase(controlUrl.href);
    await check();
    await applyMigrations(control, path.resolve("server/migrations"));
    await check();
    const organizationId = `recovery-${fixed.runId}`;
    await control.query("insert into organizations(id,name) values($1,'Synthetic recovery authority')", [organizationId]);
    await control.query("insert into roles(id,name,level,permissions) values('guest','guest','organization','{}') on conflict(id) do nothing");
    const accountPassword = `Synthetic-${randomBytes(24).toString("hex")}!`;
    const hash = await hashLocalAccountPassword(accountPassword);
    const principals = ["operator", "platform-owner", "incident-owner", "verifier"] as const;
    const authService = createLocalAuthService(control, { selfRegisterEnabled: false });
    let incidentToken = "";
    for (const kind of principals) {
      const userId = `${kind}-${fixed.runId}`;
      await control.query("insert into users(id,organization_id,name,email,title) values($1,$2,$1,$3,'Synthetic')", [userId, organizationId, `${userId}@invalid.example`]);
      await control.query("insert into user_password_credentials(user_id,username,password_hash) values($1,$1,$2)", [userId, hash]);
      await control.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$1,$2,'guest')", [userId, organizationId]);
      const result = await authService.login({ username: userId, password: accountPassword }, { requestId: `synthetic-${kind}` });
      if (kind === "incident-owner") incidentToken = result.session.token;
    }
    const role = `synthetic_auth_${fixed.runId}`, rolePassword = randomBytes(32).toString("hex");
    await check();
    await control.query(`create role ${pg.escapeIdentifier(role)} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication password ${pg.escapeLiteral(rolePassword)}`);
    await control.query(`grant select on public.auth_sessions,public.users,public.organizations,public.user_role_bindings,public.user_password_credentials to ${pg.escapeIdentifier(role)};
      grant update(last_used_at) on public.auth_sessions to ${pg.escapeIdentifier(role)}`);
    const authentication = (await control.query<DeploymentAuthorityAssignment["authentication"]>(`select current_database() as "databaseName",
      (select oid::text from pg_catalog.pg_database where datname=current_database()) as "databaseOid",
      inet_server_addr()::text as "serverAddress",inet_server_port() as "serverPort"`)).rows[0];
    const assignment: DeploymentAuthorityAssignment = { format: "wiseeff-deployment-authority-v1", runId: fixed.runId,
      target: fixed.capture.source, expiresAt: new Date(Date.now() + 600000).toISOString(), authentication,
      principals: principals.slice(0,3).map(kind => ({ kind: kind as "operator" | "platform-owner" | "incident-owner", userId: `${kind}-${fixed.runId}`, organizationId })),
      verifierPrincipals: [{ userId: `verifier-${fixed.runId}`, organizationId }], reports: [],
      restore: { attemptId: `restore-${fixed.runId}`, captureDigest: recoveryExecutionRecordDigest(fixed.capture), target: fixed.target } };
    const assignmentPath = path.join(fixed.privateDirectory, "assignment.json");
    await check();
    const file = await open(assignmentPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(JSON.stringify(assignment)); await file.sync(); } finally { await file.close(); }
    await directoryHandle.sync();
    const restricted = new URL(controlUrl); restricted.username = role; restricted.password = rolePassword;
    authority = await openDeploymentAuthority({ custodyRoot: fixed.privateDirectory, custodianUid: process.getuid!(), assignmentPath,
      expectedAssignmentDigest: sha256Prefixed(canonicalJson(assignment)), runId: fixed.runId, target: fixed.capture.source,
      sourceDatabase: fixed.sourceDatabase, authConnectionString: restricted.href });
    await check();
    const confirmation = await authority.confirmRestore({ authorization: `Bearer ${incidentToken}`, attemptId: assignment.restore!.attemptId,
      captureDigest: assignment.restore!.captureDigest, target: fixed.target, traceId: `synthetic-restore-${fixed.runId}` });
    await check();
    const approval = await recordRecoveryExecutionApproval({ journal, operationRoot: fixed.operationRoot, lock,
      confirmation, restoreToken: fixed.restoreToken });
    return { approval, close };
  } catch {
    await close().catch(() => undefined);
    return refuse();
  }
}
