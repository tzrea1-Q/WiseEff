import { buildControlledRecoveryTarget } from "./controlledRestore";
import { verifyRecoveryPackage, type RecoveryBootstrapIdentity, type VerifiedRecoveryPackage } from "../recoveryPackage";
import type { RecoveryTargetIdentity } from "../recoveryPoint";

export type RecoveryRestoreBinding = { runId: string; packageDigest: string; source: RecoveryTargetIdentity; target: RecoveryTargetIdentity };
export type RecoveryPackageTarget = {
  target: RecoveryTargetIdentity;
  /** Provided by the controller's approval adapter. It must validate the exact binding,
   * principal and purpose; this storage module cannot mint an approval. */
  authorize(binding: RecoveryRestoreBinding): Promise<void>;
  /** Mandatory for v3: inspect an already provisioned bootstrap before a journal
   * or restore write. Missing support must not fall back to v2 behavior. */
  assertBootstrap?(bootstrap?: RecoveryBootstrapIdentity): Promise<void>;
  assertEmptyAndIsolated(binding: RecoveryRestoreBinding): Promise<void>;
  /** The implementation receives ONLY verified package material and external secret
   * facilities in its closure, never a source connection or fixture oracle. */
  restore(backup: VerifiedRecoveryPackage): Promise<void>;
};
const issuedTargets = new WeakSet<object>();
/** Only this factory can enroll a target at the root execution seam. The lower
 * adapter builder and structurally identical caller objects cannot mint this. */
export function createControlledRecoveryTarget(...args: Parameters<typeof buildControlledRecoveryTarget>): RecoveryPackageTarget {
  const target = Object.freeze(buildControlledRecoveryTarget(...args));
  issuedTargets.add(target);
  return target;
}

export async function restoreRecoveryPackage(directory: string, digest: string, target: RecoveryPackageTarget) {
  if (!issuedTargets.has(target)) throw new Error("recovery-execution-unissued-target");
  const backup = await verifyRecoveryPackage(directory, digest);
  const binding = { runId: backup.manifest.recovery.runId, packageDigest: digest, source: backup.manifest.recovery.target, target: target.target };
  for (const key of ["deploymentId", "postgresIdentity", "objectStoreIdentity", "redisIdentity"] as const) {
    if (!target.target[key] || target.target[key] === binding.source[key]) throw new Error("recovery-target-not-independent");
  }
  if (backup.bootstrap || target.assertBootstrap) {
    if (!target.assertBootstrap) throw new Error("recovery-bootstrap-target-unsupported");
    await target.assertBootstrap(backup.bootstrap);
  }
  await target.authorize(binding);
  await target.assertEmptyAndIsolated(binding);
  // The existing append-only UpgradeJournal is the sole execution state. No
  // separate truncatable package journal can overwrite started/unknown evidence.
  try {
    await target.restore(backup);
    return { status: "restore-executed-not-business-verified" as const, binding };
  } catch { throw new Error("recovery-restore-outcome-unknown-target-must-remain-isolated"); }
}
