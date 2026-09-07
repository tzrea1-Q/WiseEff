import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { digestOf } from "../../../../server/modules/release-verification/core/digest";
import { VerificationGateId, type GateAdapter, type TypedEvidenceRef, type VerificationPlan } from "../../../../server/modules/release-verification/core/types";
import { verifyRecoveryPackage } from "../../storage/recoveryPackage";
import type { ControlledRecoveryBoundary, ControlledRecoverySource } from "../../storage/controlledRecovery";
import type { RecoveryTargetIdentity } from "../../storage/recoveryPoint";
import { assertHostOperationLock, type HostOperationLock } from "./handoff";
import { loadUpgradeJournal } from "./journal";

const gateIds = ["PCAT-RP-RECOVERY-POINT", "PCAT-WRITER-PRE-SWITCH-FENCE"] as const;
const refuse = (): never => { throw new Error("PCAT-UPG-RECOVERY-EVIDENCE-UNAVAILABLE"); };

/** Invocation adapter for the existing S11-RP checks and owning writer fence.
 * It creates no backup, approval, restore token, SQL effect, queue or proxy act.
 * The management root supplies live source/fence implementations, not JSON proof.
 * One factory belongs to one verification attempt; its evidence is revalidated
 * when read for assembly rather than replaying a previously passing cache.
 */
export function createControlledBoundaryEvidenceExecution(options: {
  journalPath: string; runId: string; operationRoot: string;
  target: RecoveryTargetIdentity; lock: HostOperationLock;
  source: Pick<ControlledRecoverySource, "observe">; boundary: ControlledRecoveryBoundary;
}) {
  const fixed = { ...options, target: structuredClone(options.target) };
  let firstPlan: VerificationPlan | undefined;
  let firstObservation: unknown;
  const refs = new Map<string, TypedEvidenceRef>();
  const executed = new Set<string>();
  const observe = async (plan: VerificationPlan) => {
    if (plan.purpose !== "pre-activation" || plan.lineage.trafficIsolationState !== "isolated" ||
        plan.lineage.p12State !== "not-started" || plan.lineage.p13State !== "not-started" ||
        plan.lineage.pointerRollbackStatus !== "open" || plan.lineage.predecessorReportDigests.length ||
        !path.isAbsolute(fixed.journalPath) || !fixed.journalPath.startsWith(`${fixed.operationRoot}${path.sep}`)) refuse();
    if (firstPlan && !isDeepStrictEqual(firstPlan, plan)) refuse();
    firstPlan ??= structuredClone(plan);
    await assertHostOperationLock(fixed.lock, fixed.operationRoot);
    const loaded = loadUpgradeJournal({ journalPath: fixed.journalPath, runId: fixed.runId, requireSettled: true });
    if (!loaded.ok) return refuse();
    const captures = loaded.value.record.entries.filter(entry => entry.recoveryCapture?.outcome === "committed");
    if (captures.length !== 1 || loaded.value.record.entries.some(entry => entry.action === "recovery-capture-unknown" || entry.action.startsWith("recovery-execution-"))) refuse();
    const event = captures[0].recoveryCapture!;
    const capture = event.capture;
    if (!capture || capture.runId !== fixed.runId || event.runId !== fixed.runId ||
        !isDeepStrictEqual(capture.source, fixed.target) || !isDeepStrictEqual(event.source, fixed.target)) return refuse();
    if (plan.pins.target.deploymentId !== fixed.target.deploymentId || plan.pins.target.hostFingerprint !== fixed.target.hostFingerprint ||
        plan.pins.database.targetIdentity !== fixed.target.postgresIdentity ||
        plan.pins.recovery.recoveryPointDigest !== capture.recoveryPointDigest ||
        plan.evidenceRequirements.recoveryPointDigest !== capture.recoveryPointDigest) refuse();
    const directory = event.directory.path;
    if (await realpath(directory) !== directory) refuse();
    const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const verifyDirectory = async () => {
        const named = await lstat(directory), held = await handle.stat();
        if (!named.isDirectory() || named.isSymbolicLink() || named.nlink < 1 || named.uid !== process.getuid?.() ||
            (named.mode & 0o777) !== 0o700 || String(named.dev) !== event.directory.device || String(named.ino) !== event.directory.inode ||
            held.dev !== named.dev || held.ino !== named.ino || await realpath(directory) !== directory) refuse();
      };
      const receipt = structuredClone(await fixed.boundary.acquire({ runId: fixed.runId, target: structuredClone(fixed.target) }));
      const verify = async () => {
        await assertHostOperationLock(fixed.lock, fixed.operationRoot);
        await verifyDirectory();
        if (receipt.runId !== fixed.runId || !isDeepStrictEqual(receipt.target, fixed.target) || receipt.digest !== capture.boundaryDigest ||
            !Number.isFinite(Date.parse(receipt.observedAt)) || Date.parse(receipt.observedAt) > Date.now() ||
            !Number.isFinite(Date.parse(receipt.expiresAt)) || Date.parse(receipt.expiresAt) <= Date.now()) refuse();
        await fixed.boundary.verify(structuredClone(receipt));
        if (!isDeepStrictEqual(await fixed.source.observe(), fixed.target)) refuse();
        await assertHostOperationLock(fixed.lock, fixed.operationRoot);
      };
      await verify();
      const backup = await verifyRecoveryPackage(directory, capture.packageDigest);
      const recovery = backup.manifest.recovery;
      if (recovery.runId !== fixed.runId || recovery.recoveryPointDigest !== capture.recoveryPointDigest ||
          recovery.recoveryPointId !== plan.pins.recovery.recoveryPointId || !isDeepStrictEqual(recovery.target, fixed.target)) refuse();
      await verify();
      const after = loadUpgradeJournal({ journalPath: fixed.journalPath, runId: fixed.runId, requireSettled: true });
      if (!after.ok || !isDeepStrictEqual(loaded.value.record, after.value.record)) refuse();
      const observation = { capture, directory: { device: event.directory.device, inode: event.directory.inode },
        target: fixed.target, recoveryPointId: recovery.recoveryPointId, journalDigest: loaded.value.record.journalDigest };
      if (firstObservation && !isDeepStrictEqual(firstObservation, observation)) refuse();
      firstObservation ??= structuredClone(observation);
      return observation;
    } finally { await handle.close(); }
  };
  const adapters = new Map<string, GateAdapter>();
  for (const id of gateIds) adapters.set(id, async ({ gateId, plan }) => {
    try {
      if (executed.has(id) || gateId !== id || plan.applicabilityProfile.find(entry => entry.gateId === id)?.applicability.status !== "required-now") refuse();
      executed.add(id);
      const observation = await observe(plan);
      const envelope = { producer: "controlled-recovery-boundary-v1", gateId, planDigest: plan.digest,
        purpose: plan.purpose, subject: plan.subject, phaseSnapshot: plan.lineage.phaseSnapshot,
        lineage: plan.lineage, pins: plan.pins, observation };
      const digest = digestOf(envelope);
      refs.set(id, structuredClone({ gateId, digest, producer: envelope.producer, purpose: plan.purpose,
        subject: plan.subject, phaseSnapshot: plan.lineage.phaseSnapshot, pins: plan.pins }));
      return { gateId, status: "passed", failureCode: null, evidenceDigest: digest, successorPurpose: null, notApplicableProof: null };
    } catch {
      refs.clear();
      return { gateId: VerificationGateId(id), status: "failed", failureCode: `${id}-FAILED`, evidenceDigest: null, successorPurpose: null, notApplicableProof: null };
    }
  });
  return { adapters, async readEvidence(plan: VerificationPlan): Promise<readonly TypedEvidenceRef[]> {
    try {
      await observe(plan);
      if (refs.size !== gateIds.length) refuse();
      return structuredClone(gateIds.map(id => refs.get(id)!));
    } catch { return refuse(); }
  } };
}
