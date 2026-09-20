import path from "node:path";
import { fileURLToPath } from "node:url";

import { runT33bTargetRehearsal } from "../../ops/self-hosted/storage/t33bTargetRehearsal";
import { writeSanitizedCutoverOutput } from "./cutoverDiagnostic";

const defaults = {
  postgresUrl:
    process.env.WISEEFF_T33B_POSTGRES_URL ??
    "postgres://wiseeff:t33b-postgres-secret-32chars@127.0.0.1:55442/wiseeff",
  redisUrl: process.env.WISEEFF_T33B_REDIS_URL ?? "redis://127.0.0.1:56380",
  s3Endpoint: process.env.WISEEFF_T33B_S3_ENDPOINT ?? "http://127.0.0.1:59010",
  s3Bucket: process.env.WISEEFF_T33B_S3_BUCKET ?? "wiseeff",
  s3AccessKeyId: process.env.WISEEFF_T33B_S3_ACCESS_KEY ?? "t33b-minio",
  s3SecretAccessKey: process.env.WISEEFF_T33B_S3_SECRET_KEY ?? "t33b-minio-secret-32chars",
  exclusiveToken: process.env.WISEEFF_T33B_UNFREEZE_TOKEN ?? "exclusive-t33b-token",
  publicUrl: process.env.WISEEFF_T33B_PUBLIC_URL ?? "http://127.0.0.1:18080",
};

export const runRehearseS2TargetCli = async () => {
  const result = await runT33bTargetRehearsal(defaults);
  return {
    ok: true as const,
    publicUrl: result.publicUrl,
    quiescence: {
      writersFenced: result.quiescence.writersFenced,
      queuesDrained: result.quiescence.queuesDrained,
      publicProxyStopped: result.quiescence.publicProxyStopped,
      publicationFrozen: result.quiescence.publicationFrozen,
    },
    activationReceipt: result.unfreeze.activationReceipt,
    frozenAfter: result.unfreeze.frozenAfter,
    unfreezeFailureRefrozen: result.unfreezeFailureRefrozen,
    restore: result.restore.status,
    priorCaptureRefused: result.priorCaptureRefused,
    sentinelPreserved: result.sentinelPreserved,
    postRestart: result.postRestart,
    destructiveArchiveRebuild: result.destructiveArchiveRebuild,
    recoveryPointDigest: result.restore.recoveryPointDigest,
  };
};

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runRehearseS2TargetCli()
    .then((result) => {
      process.stdout.write(writeSanitizedCutoverOutput(result));
    })
    .catch((error: unknown) => {
      process.stderr.write(
        writeSanitizedCutoverOutput(error instanceof Error ? error.message : String(error)),
      );
      process.exitCode = 1;
    });
}
