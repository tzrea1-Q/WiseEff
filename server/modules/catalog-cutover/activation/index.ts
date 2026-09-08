import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createVerificationReportService } from "../../release-verification/report/index";
import { digestOf } from "../../release-verification/core/digest";
import { assertBindingManagementLogin } from "../bindingImportProducer";
import { ActivationRefusal, type ActivationBinding, type ActivationIntent, type ActivationObservation, type ActivationOptions } from "./interface";
import { createActivationIntent, decodeBinding, refuse, validateIntent } from "./records";
import { physicalIdentity, readFacts, persistMappingEpoch, persistActivation, inspectIntent, type ActivationFacts } from "./postgres";

export { createActivationIntent };
export { ActivationRefusal } from "./interface";
export type { ActivationBinding, ActivationIdentity, ActivationInspection, ActivationIntent, ActivationJournal, ActivationObservation, ActivationOptions } from "./interface";

/** A real management lease is observed from pg's acquisition callback through
 * destruction. It never becomes an application connection or grant. */
async function withTransaction<T>(options: ActivationOptions, write: boolean, body: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  let lost = false;
  const onError = () => { lost = true; };
  const client = await new Promise<pg.PoolClient>((resolve, reject) => {
    options.managementPool.connect((error, acquired) => {
      if (error || !acquired) { reject(new ActivationRefusal("MANAGEMENT-UNAVAILABLE")); return; }
      acquired.on("error", onError); resolve(acquired);
    });
  });
  let open = false, closing = false, failed = false;
  const assertLive = () => { if (lost) refuse("MANAGEMENT-UNAVAILABLE"); };
  try {
    assertLive();
    await assertBindingManagementLogin(client); assertLive();
    // Wrong targets are rejected before BEGIN, role change, or any target lock.
    if (!isDeepStrictEqual(await physicalIdentity(client), options.target)) refuse("TARGET-MISMATCH");
    await options.boundary.verify(); assertLive();
    // Match the existing S7 session lock, before BEGIN creates a snapshot.
    // A snapshot taken before a competing controller's commit could otherwise
    // observe a stale predecessor even after obtaining the same lock.
    const lock = await client.query<{ acquired: boolean }>("select pg_catalog.pg_try_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database())) as acquired");
    if (lock.rows[0]?.acquired !== true) refuse("LOCK-UNAVAILABLE");
    await client.query(`begin isolation level repeatable read${write ? "" : " read only"}`); open = true;
    await client.query("set local search_path=pg_catalog,parameter_catalog,pg_temp");
    await client.query("set local timezone='UTC'");
    await client.query("set local role catalog_migration_owner");
    // Mapping and installer writers do not all participate in the S7 advisory
    // lock. Prevent their changes across the read/CAS boundary as well.
    if (write) await client.query(`lock table parameter_catalog.catalog_state,
      parameter_catalog.catalog_releases, parameter_catalog.catalog_materializations,
      parameter_catalog.legacy_identities, parameter_catalog.legacy_mapping_heads,
      parameter_catalog.legacy_mapping_versions in share mode nowait`);
    const value = await body(client);
    await options.boundary.verify(); assertLive();
    await client.query("reset role");
    if (!isDeepStrictEqual(await physicalIdentity(client), options.target)) refuse("TARGET-MISMATCH");
    closing = true;
    await client.query(write ? "commit" : "rollback"); open = false; closing = false;
    assertLive(); return value;
  } catch (error) {
    failed = true;
    if (closing || lost) refuse("OUTCOME-UNKNOWN");
    if (open) {
      try { await client.query("rollback"); }
      catch { refuse("OUTCOME-UNKNOWN"); }
    }
    if (error instanceof ActivationRefusal) throw error;
    return refuse("QUERY-FAILED");
  } finally {
    // Do not return a lease with uncertain role/transaction/session state to a
    // shared pool. Keep its error listener attached until the socket has ended.
    client.once("end", () => client.removeListener("error", onError));
    try { client.release(true); } catch { if (!failed) refuse("MANAGEMENT-UNAVAILABLE"); }
  }
}

function matchObservation(facts: ActivationFacts, observed: ActivationObservation, intent: ActivationIntent) {
  const pins = observed.pins;
  if (digestOf(observed) !== intent.expectedObservationDigest || observed.trafficIsolationState !== "isolated" || observed.pointerRollbackStatus !== "open" ||
      observed.predecessorReportDigests.length !== 0 || !/^sha256:[a-f0-9]{64}$/.test(observed.comparisonReportDigest)) refuse("OBSERVATION-MISMATCH");
  if (pins.artifact.gitSha !== facts.run.target_artifact_sha || pins.cutover.planDigest !== facts.run.plan_digest ||
      pins.cutover.sourceSnapshotFingerprint !== facts.run.source_snapshot_fingerprint || pins.cutover.contractVersion !== facts.run.migration_contract_version ||
      !isDeepStrictEqual(pins.catalog, { releaseId: facts.catalog.releaseId, releaseDigest: facts.catalog.releaseDigest,
        compiledModelDigest: facts.catalog.compiledFingerprint, materializationFingerprint: facts.catalog.databaseFingerprint }) ||
      !facts.mappingEpoch || pins.mappingArchive.mappingEpoch !== facts.mappingEpoch || pins.mappingArchive.mappingHeadDigest !== facts.headDigest) refuse("OBSERVATION-MISMATCH");
  if (!facts.currentBinding && observed.initialReadMode !== "legacy") refuse("SOURCE-READ-MODE-UNPROVEN");
  if (facts.currentBinding && observed.initialReadMode !== "canonical") refuse("SOURCE-READ-MODE-UNPROVEN");
}

async function approvedReport(options: ActivationOptions, observed: ActivationObservation, digest: string) {
  // This is the formal approval/retention projection, not a second verifier.
  // Root still owns the complete runCatalogReleaseAction admission boundary.
  const selected = await createVerificationReportService({ db: options.reports }).readReport(digest);
  if (selected.kind === "absent") return refuse(selected.reason === "missing" ? "REPORT-MISSING" : "REPORT-UNAPPROVED");
  const report = selected.report;
  if (report.digest !== digest || report.purpose !== "pre-activation" || report.decision !== "passed" ||
      !isDeepStrictEqual(report.pins, observed.pins) || report.phaseSnapshot !== observed.phaseSnapshot ||
      !isDeepStrictEqual(report.predecessorReportDigests, observed.predecessorReportDigests) ||
      report.pointerRollbackStatus !== observed.pointerRollbackStatus || report.evidenceRefs.length === 0 ||
      report.evidenceRefs.some(ref => !isDeepStrictEqual(ref.subject, observed.subject))) refuse("REPORT-MISMATCH");
  const comparisonReport = options.comparisonReport;
  if (!comparisonReport) return refuse("COMPARISON-REPORT-UNAVAILABLE");
  // Inspection never executes comparison gates. Load their existing public
  // projection only for apply, before any pending record or database effect.
  const { assertComparisonEvidenceAssociation, ComparisonEvidenceRefusal } =
    await import("../../release-verification/comparison/index");
  try {
    const association = assertComparisonEvidenceAssociation({
      comparisonReport, verificationReport: report, subject: observed.subject,
    });
    if (association.comparisonReportDigest !== observed.comparisonReportDigest) refuse("COMPARISON-REPORT-MISMATCH");
  } catch (error) {
    if (error instanceof ActivationRefusal) throw error;
    if (error instanceof ComparisonEvidenceRefusal) return refuse(`COMPARISON-${error.reason}`);
    return refuse("COMPARISON-REPORT-UNAVAILABLE");
  }
}

export function createApplicationReadActivation(options: ActivationOptions) {
  const fixedTarget = options.target && structuredClone(options.target);
  const fixed = { ...options, target: fixedTarget,
    comparisonReport: options.comparisonReport && structuredClone(options.comparisonReport) };
  const within = async <T>(body: () => Promise<T>): Promise<T> => {
    try { return await fixed.boundary.withLockedBoundary(body); }
    catch (error) {
      if (error instanceof ActivationRefusal) throw error;
      return refuse("BOUNDARY-UNAVAILABLE");
    }
  };
  const read = async (client: pg.PoolClient, intent: ActivationIntent) => {
    if (!isDeepStrictEqual(intent.target, fixed.target)) refuse("TARGET-MISMATCH");
    const facts = await readFacts(client, fixed.target, intent.runId, intent.planDigest);
    const attempts = await client.query<{ payload: ActivationBinding }>(`select payload from parameter_catalog.parameter_catalog_cutover_events
      where event_kind='application-read-activated' and payload#>>'{intent,attemptId}'=$1`, [intent.attemptId]);
    if (attempts.rows.some(row => !isDeepStrictEqual(decodeBinding(row.payload).intent, intent))) refuse("ATTEMPT-CONFLICT");
    return facts;
  };
  const inspectCurrent = async (client: pg.PoolClient, intent: ActivationIntent) => {
    const facts = await read(client, intent);
    const inspected = inspectIntent(facts, intent);
    if (inspected.kind === "applied" && (!isDeepStrictEqual(inspected.binding.catalog, facts.catalog) ||
        inspected.binding.mapping.headDigest !== facts.headDigest || inspected.binding.mapping.epoch !== facts.mappingEpoch ||
        inspected.binding.sourceSnapshotFingerprint !== facts.run.source_snapshot_fingerprint)) refuse("APPLIED-STATE-DRIFT");
    return inspected;
  };
  return {
    /** Explicit management preparation. It appends an epoch event, never a P11
     * verification checkpoint, report, approval, read switch, or startup pin. */
    async prepareMappingEpoch(runId: string, planDigest: string) {
      if (!runId || !/^sha256:[a-f0-9]{64}$/.test(planDigest)) refuse("INTENT-REJECTED");
      return within(() => withTransaction(fixed, true, async client => {
        const facts = await readFacts(client, fixed.target, runId, planDigest);
        const mappingEpoch = await persistMappingEpoch(client, facts);
        return { ...facts, mappingEpoch };
      }));
    },
    /** Read-only source for the owning controller's independent pins producer.
     * Missing epoch stays null; inspect never calls preparation implicitly. */
    async inspectFacts(runId: string, planDigest: string) {
      return within(() => withTransaction(fixed, false, client => readFacts(client, fixed.target, runId, planDigest)));
    },
    async inspect(input: ActivationIntent) {
      const intent = validateIntent(input);
      return within(() => withTransaction(fixed, false, client => inspectCurrent(client, intent)));
    },
    /** P13's management owner already holds the actual S7 lock on this lease.
     * Check that lease and its transaction instead of taking the same lock on
     * another connection. SAVEPOINT/RELEASE has local transaction effects only;
     * this method never begins/commits, changes roles, writes data or runs DDL.
     * It neither passes a transaction to Kernel nor issues runtime approval. */
    async inspectOnHeldManagementSession(input: ActivationIntent, client: pg.PoolClient) {
      const intent = validateIntent(input);
      const verify = async () => {
        if (!isDeepStrictEqual(await physicalIdentity(client), fixed.target)) refuse("TARGET-MISMATCH");
        const observed = (await client.query<{ same_identity: boolean; manager: boolean; isolation: string; timezone: string; locked: boolean }>(`select
          session_user=current_user as same_identity,
          (select rolsuper or (not rolinherit and not rolbypassrls and not rolcreatedb and not rolcreaterole and not rolreplication
            and pg_catalog.pg_has_role(session_user,'catalog_migration_owner','MEMBER')) from pg_catalog.pg_roles where rolname=session_user) as manager,
          pg_catalog.current_setting('transaction_isolation') as isolation, pg_catalog.current_setting('TimeZone') as timezone,
          exists(select 1 from pg_catalog.pg_locks where pid=pg_catalog.pg_backend_pid()
            and database=(select oid from pg_catalog.pg_database where datname=pg_catalog.current_database())
            and locktype='advisory' and mode='ExclusiveLock' and granted
            and classid=pg_catalog.hashtext('s7-orc-cutover-target')::oid and objid=pg_catalog.hashtext(pg_catalog.current_database())::oid and objsubid=2) as locked`)).rows[0];
        if (!observed?.same_identity || !observed.manager || !observed.locked ||
            observed.timezone !== "UTC" || !["repeatable read", "serializable"].includes(observed.isolation)) refuse("HELD-SESSION-REJECTED");
        await fixed.boundary.verify();
      };
      try {
        await verify();
        const savepoint = pg.escapeIdentifier(`activation_inspect_${randomUUID().replaceAll("-", "")}`);
        await client.query(`savepoint ${savepoint}`);
        await client.query(`release savepoint ${savepoint}`);
        const inspected = await inspectCurrent(client, intent);
        await verify();
        return inspected;
      } catch (error) {
        if (error instanceof ActivationRefusal) throw error;
        return refuse("HELD-SESSION-UNAVAILABLE");
      }
    },
    async apply(input: ActivationIntent): Promise<ActivationBinding> {
      const intent = validateIntent(input);
      return within(async () => {
        await fixed.boundary.verify();
        const observed = structuredClone(await fixed.boundary.observe());
        await approvedReport(fixed, observed, intent.reportDigest);
        let pending = false;
        try {
          const binding = await withTransaction(fixed, true, async client => {
            const facts = await read(client, intent);
            const inspected = inspectIntent(facts, intent);
            // Replay is an inspection action. It cannot issue a new host
            // committed record or silently consume another pending attempt.
            if (inspected.kind === "applied") refuse("ALREADY-APPLIED-INSPECT-REQUIRED");
            matchObservation(facts, observed, intent);
            await fixed.journal.pending(intent); pending = true;
            if (!isDeepStrictEqual(observed, await fixed.boundary.observe())) refuse("OBSERVATION-DRIFT");
            await fixed.boundary.verify();
            await approvedReport(fixed, observed, intent.reportDigest);
            const body = { version: "pcat-activation-v1" as const, intent, mode: "canonical" as const,
              sourceSnapshotFingerprint: facts.run.source_snapshot_fingerprint, catalog: facts.catalog,
              mapping: { epoch: facts.mappingEpoch!, headDigest: facts.headDigest }, comparisonReportDigest: observed.comparisonReportDigest };
            const next = decodeBinding({ ...body, bindingDigest: digestOf(body) });
            await persistActivation(client, facts, next);
            return next;
          });
          await fixed.journal.committed(binding);
          return binding;
        } catch (error) {
          if (pending) await fixed.journal.unknown(intent).catch(() => undefined);
          if (error instanceof ActivationRefusal) throw error;
          return refuse("OUTCOME-UNKNOWN");
        }
      });
    },
  };
}
