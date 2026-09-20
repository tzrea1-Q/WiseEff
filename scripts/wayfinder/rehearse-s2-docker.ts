import path from "node:path";
import { fileURLToPath } from "node:url";

import { runT33aDockerRehearsal } from "../../ops/self-hosted/storage/t33aDockerRehearsal";
import { writeSanitizedCutoverOutput } from "./cutoverDiagnostic";

const defaults = {
  postgresUrl: process.env.WISEEFF_T34A_POSTGRES_URL ?? "postgres://wiseeff:wiseeff@127.0.0.1:55441/wiseeff_t34a",
  redisUrl: process.env.WISEEFF_T34A_REDIS_URL ?? "redis://127.0.0.1:56379",
  s3Endpoint: process.env.WISEEFF_T34A_S3_ENDPOINT ?? "http://127.0.0.1:59000",
  s3Bucket: process.env.WISEEFF_T34A_S3_BUCKET ?? "wiseeff-t34a",
  s3AccessKeyId: process.env.WISEEFF_T34A_S3_ACCESS_KEY ?? "t34a-minio",
  s3SecretAccessKey: process.env.WISEEFF_T34A_S3_SECRET_KEY ?? "t34a-minio-secret-32chars",
  exclusiveToken: process.env.WISEEFF_T33A_UNFREEZE_TOKEN ?? "exclusive-t33a-token",
};

export const runRehearseS2DockerCli = async () => {
  const result = await runT33aDockerRehearsal(defaults);
  return {
    ok: true as const,
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
    recoveryPointDigest: result.restore.recoveryPointDigest,
  };
};

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runRehearseS2DockerCli()
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
