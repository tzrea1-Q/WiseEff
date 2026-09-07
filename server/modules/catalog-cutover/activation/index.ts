import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type pg from "pg";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createCatalogKernel } from "../../catalog-kernel/interface";
import { CatalogReleaseId, CatalogReleaseDigest } from "../../parameter-catalog-contract";
import { createVerificationReportService } from "../../release-verification/report";
import { digestOf } from "../../release-verification/core/digest";
import type { ReleaseVerificationReport } from "../../release-verification/core";
import { assertBindingManagementLogin } from "../bindingImportProducer";
import { activationEpochDigest, activationEpochFacts, readActivationFacts, requireActivationFact as requireFact, type ActivationFacts } from "./facts";
import { verifyCatalogReaderSession } from "./readerTarget";
import { readBindingDatabaseIdentity } from "../../parameter-bindings/cutoverImport/sourceBoundary";
import { ActivationRefusal, type ActivationAttemptInspection, type ActivationBoundary, type ActivationInspection, type ActivationOptions, type P12ActivationTarget } from "./interface";

export { ActivationRefusal } from "./interface";
export type { ActivationOptions, ActivationTargetOwner, ActivationBoundary, ActivationInspection } from "./interface";

type State = { mode: "legacy" | "canonical"; generation: string; attemptId: string | null; binding: Record<string, unknown> | null };
const readState = async (client: pg.PoolClient): Promise<State> => {
  const rows = (await client.query<State>(`select mode,generation::text,activation_attempt_id as "attemptId",binding
    from parameter_catalog.application_read_state where singleton`)).rows;
  requireFact(rows.length === 1, "pointer-unavailable");
  return rows[0];
};

/** Installer credentials stay here. Every operation owns its transaction and
 * destroys the session after an uncertain transaction end; no ambient URL.
 */
async function withManagement<T>(input: ActivationOptions, write: boolean, body: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  let client: pg.PoolClient;
  try { client = await input.managementPool.connect(); }
  catch { throw new ActivationRefusal("management-connection-failed"); }
  let transaction = false; let ending = false; let destroy = false;
  let connectionFailed = false;
  // The body can await another pool's observation while this lease is idle.
  // Keep asynchronous socket errors handled until release; never expose detail.
  const onConnectionError = () => { connectionFailed = true; destroy = true; };
  client.on("error", onConnectionError);
  try {
    await assertBindingManagementLogin(client);
    await client.query(write ? "begin isolation level serializable" : "begin isolation level repeatable read read only"); transaction = true;
    await client.query("set local role catalog_migration_owner");
    await client.query("set local row_security=off");
    // Identify the actual checkout before even taking a target lock. The later
    // full observation still repeats this check before any persistent effect.
    requireFact(isDeepStrictEqual(await readBindingDatabaseIdentity(client), input.target), "target-mismatch");
    if (write) {
      const locked = (await client.query<{ held: boolean }>("select pg_try_advisory_xact_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database())) as held")).rows[0]?.held;
      requireFact(locked === true, "controller-lock-held");
      await client.query("select id from parameter_catalog.parameter_catalog_cutover_runs where id=$1 for update", [input.runId]);
      await client.query("select singleton from parameter_catalog.application_read_state where singleton for update");
      await client.query(`lock table parameter_catalog.legacy_identities,parameter_catalog.legacy_mapping_heads,
        parameter_catalog.legacy_mapping_versions,parameter_catalog.catalog_state,parameter_catalog.catalog_releases,
        parameter_catalog.catalog_materializations,parameter_catalog.parameter_catalog_archives,
        parameter_catalog.parameter_catalog_cutover_checkpoints in share mode nowait`);
    }
    const value = await body(client);
    requireFact(!connectionFailed, "management-connection-failed");
    ending = true;
    await client.query(write ? "commit" : "rollback"); transaction = false; ending = false;
    return value;
  } catch (error) {
    if (ending) { destroy = true; throw new ActivationRefusal("transaction-outcome-unknown"); }
    if (transaction) {
      try { await client.query("rollback"); }
      catch { destroy = true; throw new ActivationRefusal("transaction-outcome-unknown"); }
    }
    if (error instanceof ActivationRefusal) throw error;
    throw new ActivationRefusal("query-failed");
  } finally {
    if (destroy) client.once("end", () => client.removeListener("error", onConnectionError));
    try { client.release(destroy); }
    finally { if (!destroy) client.removeListener("error", onConnectionError); }
  }
}

function assertOwnedPins(boundary: ActivationBoundary, facts: ActivationFacts, epoch: string): void {
  requireFact(isDeepStrictEqual(boundary.pins.catalog, facts.catalog) &&
    boundary.pins.database.targetIdentity === digestOf(facts.target) &&
    boundary.pins.database.migrationInventoryDigest === facts.migrationInventoryDigest &&
    boundary.pins.database.schemaVersion === facts.migrations.at(-1)?.name &&
    boundary.pins.artifact.gitSha === facts.run.artifactSha &&
    boundary.pins.recovery.recoveryPointDigest === facts.recoveryManifestDigest &&
    isDeepStrictEqual(boundary.pins.cutover, { planDigest: facts.run.planDigest, contractVersion: facts.run.contractVersion,
      sourceSnapshotFingerprint: facts.run.sourceSnapshotFingerprint }) &&
    isDeepStrictEqual(boundary.pins.mappingArchive, { mappingEpoch: epoch, mappingHeadDigest: facts.mappingHeadDigest,
      archiveManifestDigest: facts.archiveManifestDigest }), "owner-observation-mismatch");
}

/** Installs P12 persistence into the existing release dispatcher. This is not a
 * release command or a replacement verifier. Its owner port must be the real
 * maintenance/artifact/storage producer; there is deliberately no fallback.
 */
export function createP12Activation(input: ActivationOptions) {
  requireFact(input.owner && typeof input.owner.withLockedBoundary === "function" &&
    typeof input.owner.verify === "function" && typeof input.owner.observeBoundary === "function", "owner-unavailable");
  requireFact(input.runId.trim() && input.expectedMigrations.length, "input-incomplete");
  requireFact(typeof input.catalogReadConnectionString === "string" && input.catalogReadConnectionString.trim().length > 0, "reader-configuration-missing");
  const fixed: ActivationOptions = { ...input, target: { ...input.target }, expectedMigrations: input.expectedMigrations.map(row => ({ ...row })).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0) };
  const withBoundary = async <T>(body: () => Promise<T>): Promise<T> => {
    try { return await fixed.owner.withLockedBoundary(body); }
    catch (error) {
      if (error instanceof ActivationRefusal) throw error;
      throw new ActivationRefusal("boundary-unavailable");
    }
  };
  const verify = async () => { try { await fixed.owner.verify({ ...fixed.target }); } catch { throw new ActivationRefusal("boundary-lost"); } };
  // This component constructs the pool, so every actual Kernel checkout is
  // challenged before Kernel starts its own transaction. A caller cannot replace
  // this with a previously observed pool or an empty callback.
  const catalogReader = createPostgresDatabase(fixed.catalogReadConnectionString, { verifyCheckout: async session => {
    await verify();
    await withManagement(fixed, false, client => verifyCatalogReaderSession(client, session, fixed.target));
    await verify();
  } });
  const catalogReadPool = getRootPostgresPool(catalogReader)!;
  const inspectLocked = async (): Promise<ActivationInspection> => {
    await verify();
    const observed = await withManagement(fixed, false, async client => {
      const facts = await readActivationFacts(client, fixed);
      const mappingEpoch = activationEpochDigest(facts);
      const epoch = (await client.query("select facts from parameter_catalog.cutover_mapping_epochs where epoch_digest=$1", [mappingEpoch])).rows[0];
      if (epoch) requireFact(isDeepStrictEqual(epoch.facts, activationEpochFacts(facts)), "epoch-tampered");
      return { ...await readState(client), facts, factsDigest: digestOf(facts), mappingEpoch, epochPrepared: !!epoch,
        attempts: (await client.query<{ id: string; state: string; request_digest: string; refusal_code: string | null }>(
          "select id,state,request_digest,refusal_code from parameter_catalog.cutover_activation_attempts where cutover_run_id=$1 order by created_at,id", [fixed.runId])).rows };
    });
    await verify();
    // Kernel retains transaction ownership. Never pass this module's client to it.
    const loaded = await createCatalogKernel(catalogReadPool).loadCurrentCatalog({ id: CatalogReleaseId(observed.facts.catalog.releaseId), digest: CatalogReleaseDigest(observed.facts.catalog.releaseDigest) });
    requireFact(loaded.ok && loaded.value.compiledFingerprint === observed.facts.catalog.compiledModelDigest && loaded.value.databaseFingerprint === observed.facts.catalog.materializationFingerprint, "catalog-unavailable");
    await verify();
    const after = await withManagement(fixed, false, async client => ({ facts: await readActivationFacts(client, fixed), state: await readState(client) }));
    requireFact(digestOf(after.facts) === observed.factsDigest && isDeepStrictEqual(after.state, { mode: observed.mode, generation: observed.generation, attemptId: observed.attemptId, binding: observed.binding }), "observation-drift");
    await verify();
    return observed;
  };
  const inspect = () => withBoundary(inspectLocked);
  /** Reconcile reads committed effect records even when current source/mapping
   * has drifted or a run needs recovery. It never repairs or clears an attempt.
   * A pending result is deliberately not a retry authorization.
   */
  const readAttempt = (attemptId: string): Promise<ActivationAttemptInspection & { appliedBinding: Readonly<Record<string, unknown>> | null }> => withBoundary(async () => {
    await verify();
    const result = await withManagement(fixed, false, async client => {
      requireFact(digestOf(await readBindingDatabaseIdentity(client)) === digestOf(fixed.target), "target-mismatch");
      const state = await readState(client);
      const attempt = (await client.query("select id,state,request_digest,report_digest,epoch_digest,expected_generation::text from parameter_catalog.cutover_activation_attempts where id=$1 and cutover_run_id=$2", [attemptId, fixed.runId])).rows[0];
      const checkpoint = (await client.query("select checkpoint_digest,payload from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id=$1 and phase='P12'", [fixed.runId])).rows[0];
      const events = (await client.query("select payload from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$1 and phase='P12' and event_kind='application-read-activated'", [fixed.runId])).rows;
      let outcome: ActivationAttemptInspection["outcome"] = "missing";
      if (attempt) {
        const payload = { attemptId, requestDigest: attempt.request_digest, mappingEpoch: attempt.epoch_digest, reportDigest: attempt.report_digest };
        const committed = attempt.state === "applied" && state.mode === "canonical" && state.attemptId === attemptId &&
          BigInt(state.generation) === BigInt(attempt.expected_generation) + 1n &&
          digestOf({ attemptId, expectedGeneration: attempt.expected_generation, binding: state.binding }) === attempt.request_digest &&
          checkpoint?.checkpoint_digest === digestOf(payload) && isDeepStrictEqual(checkpoint.payload, payload) &&
          events.length === 1 && isDeepStrictEqual(events[0].payload, payload);
        const pending = attempt.state === "pending" && state.mode === "legacy" && state.generation === attempt.expected_generation && !checkpoint && events.length === 0;
        outcome = committed ? "applied" : pending ? "pending" : "inconsistent";
      }
      return { outcome, attemptId, requestDigest: attempt?.request_digest ?? null,
        pointerGeneration: state.generation, pointerMode: state.mode,
        appliedBinding: outcome === "applied" ? state.binding : null };
    });
    await verify();
    return result;
  });
  const inspectAttempt = async (attemptId: string): Promise<ActivationAttemptInspection> => {
    const { appliedBinding: _binding, ...inspection } = await readAttempt(attemptId);
    return inspection;
  };
  /** The next owner reads the atomically bound P12 facts without crossing private
   * tables. These are historical activation facts, not current runtime approval.
   */
  const inspectAppliedBinding = async (attemptId: string): Promise<Readonly<Record<string, unknown>>> => {
    const observed = await readAttempt(attemptId);
    requireFact(observed.outcome === "applied" && observed.appliedBinding, `activation-${observed.outcome}`);
    return structuredClone(observed.appliedBinding!);
  };
  const prepareEpoch = () => withBoundary(async () => {
    const observed = await inspectLocked();
    requireFact(observed.mode === "legacy" && !observed.attempts.some(attempt => attempt.state === "pending"), "activation-not-idle");
    await verify();
    await withManagement(fixed, true, async client => {
      const facts = await readActivationFacts(client, fixed);
      requireFact(digestOf(facts) === observed.factsDigest, "observation-drift");
      await verify();
      await client.query("insert into parameter_catalog.cutover_mapping_epochs(epoch_digest,cutover_run_id,facts) values($1,$2,$3::jsonb) on conflict(epoch_digest) do nothing", [observed.mappingEpoch, fixed.runId, JSON.stringify(activationEpochFacts(facts))]);
      const saved = (await client.query("select facts from parameter_catalog.cutover_mapping_epochs where epoch_digest=$1", [observed.mappingEpoch])).rows[0];
      requireFact(saved && isDeepStrictEqual(saved.facts, activationEpochFacts(facts)), "epoch-tampered");
      await verify();
    });
    return observed.mappingEpoch;
  });

  const installTarget = (attemptId: string): P12ActivationTarget => {
    requireFact(typeof attemptId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(attemptId), "attempt-invalid");
    let active = false;
    let current: { observed: ActivationInspection; boundary: ActivationBoundary } | undefined;
    const observeBoundary = async () => {
      requireFact(active, "dispatcher-boundary-required");
      const observed = await inspectLocked();
      const boundary = await fixed.owner.observeBoundary(observed.facts, observed.mappingEpoch);
      assertOwnedPins(boundary, observed.facts, observed.mappingEpoch);
      requireFact(boundary.p12State === (observed.mode === "legacy" ? "not-started" : "completed"), "pointer-owner-mismatch");
      current = { observed, boundary };
      return structuredClone(boundary);
    };
    const activateP12 = async (supplied: ReleaseVerificationReport) => {
      requireFact(active && current, "dispatcher-boundary-required");
      const selected = current!;
      const reobserveOwner = async () => {
        await verify();
        requireFact(isDeepStrictEqual(await fixed.owner.observeBoundary(selected.observed.facts, selected.observed.mappingEpoch), selected.boundary), "owner-observation-drift");
      };
      requireFact(selected.observed.epochPrepared && selected.observed.mode === "legacy" && !selected.observed.attempts.some(attempt => attempt.state === "pending"), "activation-not-idle");
      // Defense in depth: this effect never treats a caller-built passed object as
      // approval. Report owns actual approval/retention/lineage validation.
      const approved = await createVerificationReportService({ db: fixed.reportDatabase }).readReport(supplied.digest);
      requireFact(approved.kind === "present", approved.kind === "absent" ? `report-${approved.reason}` : "report-absent");
      if (approved.kind !== "present") throw new ActivationRefusal("report-absent");
      const report = approved.report;
      requireFact(report.purpose === "pre-activation" && report.mode === "populated" && report.decision === "passed" && isDeepStrictEqual(report, supplied), "report-mismatch");
      // Full action/purpose/applicability remains the existing dispatcher contract.
      requireFact(isDeepStrictEqual(report.pins, selected.boundary.pins) && report.phaseSnapshot === selected.boundary.phaseSnapshot &&
        isDeepStrictEqual(report.predecessorReportDigests, selected.boundary.predecessorReportDigests) && report.pointerRollbackStatus === "open" &&
        selected.boundary.trafficIsolationState === "isolated" && selected.boundary.p13State === "not-started" &&
        report.evidenceRefs.length > 0 && report.evidenceRefs.every(ref => isDeepStrictEqual(ref.subject, selected.boundary.subject)), "report-boundary-mismatch");
      const binding = { contract: "pcat-p12-binding-v1", runId: fixed.runId, facts: selected.observed.facts,
        mappingEpoch: selected.observed.mappingEpoch, reportDigest: report.digest,
        evidenceDigests: report.evidenceDigests, subject: selected.boundary.subject, pins: report.pins };
      const requestDigest = digestOf({ attemptId, expectedGeneration: selected.observed.generation, binding });
      await reobserveOwner();
      // Durable intent precedes the CAS. Any uncertain return leaves a pending
      // attempt which inspect reports; no action automatically retries it.
      await withManagement(fixed, true, async client => {
        const observed = await readState(client);
        requireFact(observed.mode === "legacy" && observed.generation === selected.observed.generation, "cas-conflict");
        requireFact(digestOf(await readActivationFacts(client, fixed)) === selected.observed.factsDigest, "observation-drift");
        const previous = (await client.query("select id from parameter_catalog.cutover_activation_attempts where id=$1 or (cutover_run_id=$2 and state='pending')", [attemptId, fixed.runId])).rows;
        requireFact(previous.length === 0, "attempt-requires-reconcile");
        await client.query(`insert into parameter_catalog.cutover_activation_attempts(id,cutover_run_id,report_digest,epoch_digest,request_digest,expected_generation,state)
          values($1,$2,$3,$4,$5,$6,'pending')`, [attemptId, fixed.runId, report.digest, selected.observed.mappingEpoch, requestDigest, selected.observed.generation]);
        await reobserveOwner();
      });
      try {
        await withManagement(fixed, true, async client => {
          await reobserveOwner();
          requireFact(digestOf(await readActivationFacts(client, fixed)) === selected.observed.factsDigest, "observation-drift");
          const attempt = (await client.query("select state,request_digest from parameter_catalog.cutover_activation_attempts where id=$1 for update", [attemptId])).rows[0];
          requireFact(attempt?.state === "pending" && attempt.request_digest === requestDigest, "attempt-requires-reconcile");
          const updated = await client.query(`update parameter_catalog.application_read_state set mode='canonical',generation=generation+1,
            activation_attempt_id=$1,binding=$2::jsonb,activated_at=now() where singleton and mode='legacy' and generation=$3`, [attemptId, JSON.stringify(binding), selected.observed.generation]);
          requireFact(updated.rowCount === 1, "cas-conflict");
          const payload = { attemptId, requestDigest, mappingEpoch: selected.observed.mappingEpoch, reportDigest: report.digest };
          await client.query(`insert into parameter_catalog.parameter_catalog_cutover_events(id,cutover_run_id,sequence_number,phase,event_kind,payload)
            select $1,$2,coalesce(max(sequence_number),0)+1,'P12','application-read-activated',$3::jsonb
            from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$2`, [`cevt_${randomUUID()}`, fixed.runId, JSON.stringify(payload)]);
          await client.query("insert into parameter_catalog.parameter_catalog_cutover_checkpoints(cutover_run_id,phase,checkpoint_digest,payload) values($1,'P12',$2,$3::jsonb)", [fixed.runId, digestOf(payload), JSON.stringify(payload)]);
          await client.query("update parameter_catalog.parameter_catalog_cutover_runs set current_phase='P12',updated_at=now() where id=$1", [fixed.runId]);
          await client.query("update parameter_catalog.cutover_activation_attempts set state='applied',finished_at=now() where id=$1", [attemptId]);
          await reobserveOwner();
        });
      } catch (error) {
        // Keep even known failures pending: the existing controller must reconcile
        // the persisted pointer/attempt under its actual boundary before retry.
        if (error instanceof ActivationRefusal) throw error;
        throw new ActivationRefusal("transaction-outcome-unknown");
      }
    };
    return {
      withExclusiveBoundary: body => withBoundary(async () => {
        requireFact(!active, "dispatcher-reentrant"); active = true;
        try { await verify(); return await body(); } finally { active = false; current = undefined; }
      }), observeBoundary, activateP12,
      async startCandidate() { throw new ActivationRefusal("runtime-effect-not-installed"); },
      async releasePublic() { throw new ActivationRefusal("public-effect-not-installed"); },
    };
  };
  return { inspect, inspectAttempt, inspectAppliedBinding, prepareEpoch, installTarget, close: () => catalogReader.close() };
}
