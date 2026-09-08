import { Socket } from "node:net";
import { randomInt } from "node:crypto";
import { TLSSocket } from "node:tls";
import pg from "pg";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { createSavepointDatabase } from "../../../../server/shared/database/client";
import { readBindingDatabaseIdentity } from "../../../../server/modules/catalog-cutover/bindingImportProducer";
import { planCutover } from "../../../../server/modules/catalog-cutover/orchestrator";
import { captureComparisonP0Graph } from "../../../../server/modules/catalog-cutover/comparisonRules";
import { captureConversionSourceSnapshot, type ConversionSourceSnapshot } from "../../../../server/modules/catalog-cutover/conversionManifest";
import { readLegacySourceRegistry } from "../../../../server/modules/catalog-cutover/mapping";
import type { ExecuteCutoverInput, PlanCutoverInput } from "../../../../server/modules/catalog-cutover/interface";
import { captureComparisonPlanInventory, type ComparisonPlanSourceBinding } from "../../../../server/modules/release-verification/comparison/planInventory";
import { assertHostOperationLockForJournal, verifyStoppedHandoff, openHandoffRuntimeConfigurationLease, type HandoffObserver, type HandoffPlan, type HostOperationLock } from "./handoff";
import { canonicalJson, loadUpgradeJournal } from "./journal";
import { observeLegacySourceEndpoint } from "./legacyWriterSource";

/** R3 boundary: the original source management credential is provided only by
 * the maintenance root. No runtime/report pool fallback, role change, grant,
 * startup permission, or caller-supplied comparison outcome exists here.
 * Source reads and planning use one actual transaction; the root retains this
 * lease until its existing journal commit. verify() is for the pre-commit
 * boundary only; after committing the journal the root must call only close().
 * close() releases, never commits SQL.
 */
export class ComparisonSourceError extends Error {
  constructor(readonly code: string) { super(`PCAT-COMPARISON-SOURCE-${code}`); }
}
function requireFact(value: unknown, code: string): asserts value {
  if (!value) throw new ComparisonSourceError(code);
}

/** A source lease may expose a read view to its caller, but the caller must
 * never receive the object that a later producer trusts. Keep the copy
 * boundary explicit and verify the structured clone before returning it. */
const cloneConversionSourceSnapshot = (snapshot: ConversionSourceSnapshot): ConversionSourceSnapshot => {
  const copy = structuredClone(snapshot);
  requireFact(canonicalJson(copy) === canonicalJson(snapshot), "SOURCE-SNAPSHOT-COPY-FAILED");
  return copy;
};

// Exact source relations traversed by the eleven legacy inventory readers and
// their existing repository/service calls. This is not a new runtime grant list.
const sourceRelations = [
  "public.organizations", "public.projects", "public.parameter_specs", "public.parameter_spec_versions",
  "public.parameter_spec_review_tasks", "public.attribution_subjects", "public.driver_registrations",
  "public.driver_registration_placements", "public.driver_schemas", "public.driver_schema_versions",
  "public.parameter_modules", "public.parameter_module_mappings", "public.parameter_module_dismissed_compatibles",
  "public.project_parameter_bindings", "public.project_parameter_binding_revisions", "public.project_parameter_values",
  "public.project_parameter_files", "public.project_parameter_file_versions", "public.dts_logical_nodes",
  "public.dts_logical_node_revisions", "public.dts_config_revisions", "public.dts_config_revision_members",
  "public.dts_config_set", "public.dts_property_specs", "public.agent_sessions", "public.agent_tool_calls",
  "public.agent_approvals", "public.log_records", "public.knowledge_parameter_references", "public.debugging_parameters",
  "public.debug_nodes", "public.debug_node_bindings", "public.debugging_parameter_node_bindings", "public.node_operations",
  "public.debugging_sessions", "public.debugging_snapshots", "public.dts_reload_runs", "public.dts_reload_run_targets",
  // resolve_legacy_identity_owner(audit-subject-link) joins the actual event.
  "public.audit_events",
  "public.node_type_definitions", "public.parameter_policy_targets", "public.identity_mapping_tasks", "public.users",
  // The original MOD list still reads organization coverage overlays and its
  // schema-file cache. These locks cover its DB reads, not filesystem custody.
  "public.driver_schema_overlays", "public.driver_schema_overlay_properties",
] as const;

const parseUrl = (value: string | undefined) => {
  try {
    requireFact(value, "CONFIG-UNAVAILABLE");
    const url = new URL(value);
    requireFact(["postgres:", "postgresql:"].includes(url.protocol) && !url.search && !url.hash &&
      url.username && url.password && /^\/[a-zA-Z0-9_-]+$/.test(url.pathname), "TRANSPORT-UNSUPPORTED");
    decodeURIComponent(url.username); decodeURIComponent(url.password);
    return url;
  } catch { throw new ComparisonSourceError("TRANSPORT-UNSUPPORTED"); }
};

type SourceInput = {
  handoff: HandoffPlan; expectedHandoffDigest: string; lock: HostOperationLock;
  /** Existing composition-root store observations, never receipt booleans. */
  observer: HandoffObserver;
  /** Original source owner's registered set, including its observation helper.
   * The endpoint independently verifies every actual owner label and network
   * member. The root must never assemble this by discovering new consumers. */
  registeredSourceContainerIds: readonly string[];
  /** Original private source-management input, owned by the same root as the
   * retirement adapter. It is never returned or persisted by this module. */
  administrativeConnectionString: string;
};

export async function openComparisonPlanSource(input: SourceInput) {
  return openSource(input);
}

type SourceLease = {
  close(): Promise<void>;
  verify(): Promise<ComparisonPlanSourceBinding>;
  inventory: Awaited<ReturnType<typeof captureComparisonPlanInventory>>;
  readGraph(): Awaited<ReturnType<typeof captureComparisonP0Graph>>;
  conversionSourceSnapshot: Awaited<ReturnType<typeof captureConversionSourceSnapshot>>;
  plan(input: Omit<PlanCutoverInput, "comparisonInventory">): ReturnType<typeof planCutover>;
  openForExecution: NonNullable<ExecuteCutoverInput["openComparisonSource"]>;
};

async function openSource(input: SourceInput, management?: pg.PoolClient): Promise<SourceLease> {
  const handoff = structuredClone(input.handoff), expectedDigest = input.expectedHandoffDigest, lock = input.lock, observer = input.observer;
  requireFact(Array.isArray(input.registeredSourceContainerIds), "SOURCE-REGISTRATION-UNAVAILABLE");
  const registrations = [...input.registeredSourceContainerIds];
  const sourceIds = [...handoff.inputs.source.applications, ...handoff.inputs.source.stores].map(service => service.containerId);
  requireFact(sourceIds.length === 6 && new Set(sourceIds).size === 6 && new Set(registrations).size === registrations.length &&
    registrations.every(id => /^[a-f0-9]{64}$/.test(id)) && sourceIds.every(id => registrations.includes(id)), "SOURCE-REGISTRATION-UNAVAILABLE");
  input = { handoff, expectedHandoffDigest: expectedDigest, lock, observer, registeredSourceContainerIds: registrations,
    administrativeConnectionString: input.administrativeConnectionString };
  const administrativeUrl = parseUrl(input.administrativeConnectionString);
  await assertHostOperationLockForJournal(lock, handoff.inputs.journalPath);
  const initialJournal = loadUpgradeJournal({ journalPath: handoff.inputs.journalPath, runId: handoff.inputs.runId, requireSettled: true });
  requireFact(initialJournal.ok, "JOURNAL-UNAVAILABLE");
  const initialRecord = canonicalJson(initialJournal.value.record);
  const config = await openHandoffRuntimeConfigurationLease(handoff, expectedDigest, lock);
  let pool: pg.Pool | undefined, client: pg.PoolClient | undefined;
  let lost = false, closed = false, released = false, closing: Promise<void> | undefined;
  const onLoss = () => { lost = true; };
  management?.on("error", onLoss); management?.on("end", onLoss);
  const close = () => closing ??= (async () => {
    closed = true;
    const results = await Promise.allSettled([
      (async () => {
        try {
          if (client && !released) {
            try { requireFact(client instanceof pg.Client, "CLOSE-FAILED"); await client.end(); }
            finally { released = true; client.release(true); }
          }
        } finally { if (pool) await pool.end(); }
      })(),
      config.close(),
    ]);
    management?.off("error", onLoss); management?.off("end", onLoss);
    if (results.some(result => result.status === "rejected")) throw new ComparisonSourceError("CLOSE-FAILED");
  })();
  try {
    requireFact(administrativeUrl.hostname === "127.0.0.1" && administrativeUrl.port, "ENDPOINT-UNPROVEN");
    const docker = createIsolatedUpgradeDocker();
    requireFact(docker.daemonId === handoff.inputs.expectedDaemonId, "DAEMON-MISMATCH");
    requireFact(canonicalJson(structuredClone(await verifyStoppedHandoff(handoff, expectedDigest, observer, lock))) === canonicalJson(handoff.observation), "HANDOFF-DRIFT");
    const stores = handoff.inputs.source.stores.filter(store => store.service === "postgres");
    requireFact(stores.length === 1, "TARGET-UNAVAILABLE");
    const postgres = stores[0]!;
    const pin = handoff.observation.stores.find(store => store.service === "postgres");
    requireFact(pin && pin.id === postgres.containerId, "TARGET-UNAVAILABLE");
    const inspect = () => {
      const actual = JSON.parse(docker.command(["inspect", postgres.containerId]).toString())[0];
      const ports = actual?.NetworkSettings?.Ports?.["5432/tcp"];
      requireFact(actual?.Id === pin.id && actual.Image === pin.imageId && actual.State?.Running === true &&
        actual.Mounts?.some((mount: { Name?: string; Destination?: string }) => mount.Name === postgres.volumeName && mount.Destination === postgres.destination) &&
        Array.isArray(ports) && ports.length === 1 && ports[0].HostIp === "127.0.0.1" && ports[0].HostPort === administrativeUrl.port, "ENDPOINT-DRIFT");
      return canonicalJson({ id: actual.Id, image: actual.Image, started: actual.State.StartedAt, ports, mounts: actual.Mounts });
    };
    const container = inspect();
    const environment = await config.read();
    const sourceSystem = environment.management.WISEEFF_UPGRADE_SOURCE_SYSTEM;
    requireFact(typeof sourceSystem === "string" && sourceSystem.length > 0 && sourceSystem.replace(/^ +| +$/g, "") === sourceSystem,
      "SOURCE-NAMESPACE-UNDECLARED");
    const verifySourceEndpoints = () => {
      for (const service of ["api", "worker"] as const) {
        const application = handoff.inputs.source.applications.filter(app => app.service === service);
        requireFact(application.length === 1, "SOURCE-UNAVAILABLE");
        const source = parseUrl(environment[service].DATABASE_URL);
        requireFact(source.pathname === administrativeUrl.pathname, "DATABASE-MISMATCH");
        observeLegacySourceEndpoint({ docker, sourceUrl: source.href, administrativeUrl: administrativeUrl.href,
          applicationId: application[0]!.containerId, postgresId: postgres.containerId,
          registeredIds: registrations, ownerRunId: handoff.inputs.runId });
      }
    };
    verifySourceEndpoints();
    await assertHostOperationLockForJournal(lock, handoff.inputs.journalPath);
    pool = new pg.Pool({ connectionString: administrativeUrl.href, max: 1, connectionTimeoutMillis: 5000, query_timeout: 5000 });
    pool.on("error", onLoss);
    client = await new Promise<pg.PoolClient>((resolve, reject) => {
      pool!.connect((error, checkedOut) => {
        if (checkedOut) { client = checkedOut; checkedOut.on("error", onLoss); checkedOut.on("end", onLoss); }
        if (error || !checkedOut) reject(new ComparisonSourceError("CONNECTION-UNAVAILABLE"));
        else resolve(checkedOut);
      });
    });
    const source = client;
    const stream = source instanceof pg.Client ? source.connection.stream : undefined;
    const peer = () => requireFact(source instanceof pg.Client && source.connection.stream === stream &&
      stream instanceof Socket && !(stream instanceof TLSSocket) && !stream.destroyed &&
      stream.remoteAddress === "127.0.0.1" && String(stream.remotePort) === administrativeUrl.port, "SESSION-ENDPOINT-MISMATCH");
    const live = () => { requireFact(!closed && !lost, "CONNECTION-LOST"); peer(); };
    live();
    const schemas = (await source.query<{ schemas: string[] }>("select pg_catalog.current_schemas(true)::text[] as schemas")).rows[0]?.schemas;
    requireFact(canonicalJson(schemas) === canonicalJson(["pg_catalog", "public"]), "RESOLUTION-UNSAFE");
    const identity = (await source.query<{ oid: string; name: string }>("select oid::text,rolname as name from pg_catalog.pg_roles where rolname=session_user and session_user=current_user and rolcanlogin")).rows[0];
    requireFact(identity && identity.name === decodeURIComponent(administrativeUrl.username), "MANAGEMENT-IDENTITY-MISMATCH");
    const target = await readBindingDatabaseIdentity(source);
    await assertHostOperationLockForJournal(lock, handoff.inputs.journalPath);
    live();
    let managementPid: number | undefined, challenge: number | undefined;
    if (management) {
      requireFact(management instanceof pg.Client && canonicalJson(await readBindingDatabaseIdentity(management)) === canonicalJson(target), "MANAGEMENT-TARGET-MISMATCH");
      // The executor owns this transaction. The challenge is released by its
      // commit/rollback; this source owner never ends the borrowed session.
      challenge = randomInt(1, 2147483647);
      managementPid = (await management.query<{ pid: number }>("select pg_catalog.pg_backend_pid() as pid,pg_catalog.pg_advisory_xact_lock(824014,$1)", [challenge])).rows[0]?.pid;
      requireFact(Number.isSafeInteger(managementPid), "MANAGEMENT-SESSION-UNAVAILABLE");
    } else {
      const acquired = (await source.query<{ acquired: boolean }>("select pg_catalog.pg_try_advisory_lock(pg_catalog.hashtext('s7-orc-cutover-target'),pg_catalog.hashtext(pg_catalog.current_database())) as acquired")).rows[0]?.acquired;
      requireFact(acquired === true, "S7-UNAVAILABLE");
    }
    const discovered = await readLegacySourceRegistry(source);
    const relations = [...new Set([...sourceRelations, ...discovered.flatMap(entry => entry.sourceRelation === null ? [] : [entry.sourceRelation])])].sort();
    const heldRelations = ["pg_catalog.pg_proc", "pg_catalog.pg_class", "pg_catalog.pg_attribute", "pg_catalog.pg_namespace", ...relations,
      // Planning writes nothing. During execution the original manager owns
      // the registry lock and P0 INSERT; a second SHARE would self-block it.
      ...(!management ? ["parameter_catalog.legacy_identities"] : [])];
    // Acquire the complete relation fence before the first MVCC snapshot. All
    // later inventory queries use this same client, not a pool assembled view.
    await source.query("begin isolation level repeatable read");
    // These four current-database catalogs back the registry function, relation
    // names and source column definitions. Lock all metadata and source tables
    // before the first snapshot; a NOWAIT conflict leaves no partial capture.
    await source.query(`lock table ${heldRelations.join(",")} in share mode nowait`);
    await source.query("set transaction read only");
    await source.query("set local row_security=off");
    requireFact(canonicalJson(await readLegacySourceRegistry(source)) === canonicalJson(discovered), "SOURCE-REGISTRY-DRIFT");
    const binding: ComparisonPlanSourceBinding = { hostRunId: handoff.inputs.runId, handoffDigest: expectedDigest,
      sourceSystem, managementConfigurationDigest: handoff.observation.privateConfigurations.runtime.WISEEFF_MANAGEMENT_ENV_FILE.digest,
      target, sourceSha: handoff.inputs.source.sha, candidateSha: handoff.inputs.candidate.sha };
    const observe = async () => { try {
      live();
      requireFact(inspect() === container, "ENDPOINT-DRIFT"); verifySourceEndpoints();
      const observed = structuredClone(await verifyStoppedHandoff(handoff, expectedDigest, observer, lock));
      requireFact(canonicalJson(observed) === canonicalJson(handoff.observation), "HANDOFF-DRIFT");
      const current = await config.read();
      requireFact(canonicalJson(current) === canonicalJson(environment), "CONFIG-DRIFT");
      const locks = (await source.query<{ locked: number; s7: boolean; manager: boolean }>(`select
        (select count(distinct relation)::int from pg_catalog.pg_locks where pid=pg_catalog.pg_backend_pid() and granted
          and mode='ShareLock' and database=$2::oid and relation=any($1::regclass[])) as locked,
        exists(select 1 from pg_catalog.pg_locks where pid=coalesce($3::int,pg_catalog.pg_backend_pid()) and granted and locktype='advisory'
          and mode='ExclusiveLock' and database=$2::oid and objsubid=2
          and classid=pg_catalog.hashtext('s7-orc-cutover-target')::oid and objid=pg_catalog.hashtext(pg_catalog.current_database())::oid) as s7,
        ($3::int is null or (exists(select 1 from pg_catalog.pg_locks where pid=$3::int and granted and database=$2::oid
          and locktype='advisory' and mode='ExclusiveLock' and classid=824014::oid and objid=$4::oid and objsubid=2)
          and exists(select 1 from pg_catalog.pg_locks where pid=$3::int and granted and database=$2::oid
          and relation='parameter_catalog.legacy_identities'::regclass and mode='ShareRowExclusiveLock'))) as manager`,
      [heldRelations, target.databaseOid, managementPid ?? null, challenge ?? null])).rows[0];
      requireFact(locks?.locked === heldRelations.length && locks.s7 === true &&
        (!management || locks.manager === true) &&
        canonicalJson(await readBindingDatabaseIdentity(source)) === canonicalJson(target), "SOURCE-FENCE-LOST");
      const currentJournal = loadUpgradeJournal({ journalPath: handoff.inputs.journalPath, runId: handoff.inputs.runId, requireSettled: true });
      requireFact(currentJournal.ok && canonicalJson(currentJournal.value.record) === initialRecord, "JOURNAL-DRIFT");
      await assertHostOperationLockForJournal(lock, handoff.inputs.journalPath);
      live();
      return structuredClone(binding);
    } catch (error) {
      if (error instanceof ComparisonSourceError) throw error;
      throw new ComparisonSourceError("OBSERVATION-UNAVAILABLE");
    }
    };
    const graph = await captureComparisonP0Graph(source, sourceSystem);
    const conversionSourceSnapshot = cloneConversionSourceSnapshot(await captureConversionSourceSnapshot(source));
    const inventory = await captureComparisonPlanInventory(createSavepointDatabase(source), { observe }, graph);
    return Object.freeze({ close, verify: observe, inventory,
      get conversionSourceSnapshot() {
        live();
        return cloneConversionSourceSnapshot(conversionSourceSnapshot);
      },
      // The plan lease must have ended before executeCutover acquires S7.
      // Only this original root closure may reopen its private source input.
      async openForExecution(manager: pg.PoolClient) {
        requireFact(closed && closing, "PLAN-LEASE-STILL-OPEN"); await closing;
        return openSource(input, manager);
      },
      readGraph: () => { live(); return structuredClone(graph); }, async plan(planInput: Omit<PlanCutoverInput, "comparisonInventory">) {
      requireFact(!Object.hasOwn(planInput, "comparisonInventory"), "CALLER-SELECTION-REFUSED");
      planInput = { ...planInput, graph: structuredClone(planInput.graph),
        managementPreparation: planInput.managementPreparation && structuredClone(planInput.managementPreparation),
        conversionManifest: planInput.conversionManifest && structuredClone(planInput.conversionManifest),
        bindingImportIntent: planInput.bindingImportIntent && structuredClone(planInput.bindingImportIntent) };
      await observe();
      const result = await planCutover({ ...planInput, comparisonInventory: inventory });
      await observe();
      return result;
    } });
  } catch (error) {
    try { await close(); }
    catch { throw new ComparisonSourceError("OPEN-AND-CLOSE-FAILED"); }
    if (error instanceof ComparisonSourceError) throw error;
    throw new ComparisonSourceError("OPEN-UNAVAILABLE");
  }
}
