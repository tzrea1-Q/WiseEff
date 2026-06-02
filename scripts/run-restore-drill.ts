export type RestoreTargetInput = {
  liveDatabaseUrl?: string;
  restoreDatabaseUrl?: string;
  liveBucket?: string;
  restoreBucket?: string;
  restorePrefix?: string;
};

export type RestoreTargetEvaluation = {
  status: "passed" | "failed";
  unsafeFields: string[];
  validationErrors: string[];
};

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function evaluateRestoreTargets(input: RestoreTargetInput): RestoreTargetEvaluation {
  const unsafeFields: string[] = [];
  const validationErrors: string[] = [];
  const liveDatabaseUrl = normalize(input.liveDatabaseUrl);
  const restoreDatabaseUrl = normalize(input.restoreDatabaseUrl);
  const liveBucket = normalize(input.liveBucket);
  const restoreBucket = normalize(input.restoreBucket);
  const restorePrefix = input.restorePrefix?.trim() ?? "";

  if (!restoreDatabaseUrl) {
    unsafeFields.push("restoreDatabaseUrl");
    validationErrors.push("restoreDatabaseUrl is required.");
  } else if (liveDatabaseUrl && restoreDatabaseUrl === liveDatabaseUrl) {
    unsafeFields.push("restoreDatabaseUrl");
    validationErrors.push("restoreDatabaseUrl must not match the live database URL.");
  }

  if (!restoreBucket) {
    unsafeFields.push("restoreBucket");
    validationErrors.push("restoreBucket is required.");
  } else if (liveBucket && restoreBucket === liveBucket) {
    unsafeFields.push("restoreBucket");
    validationErrors.push("restoreBucket must not match the live object-store bucket.");
  }

  if (!restorePrefix || !restorePrefix.endsWith("/") || restorePrefix === "/") {
    unsafeFields.push("restorePrefix");
    validationErrors.push("restorePrefix must be non-empty and end with '/'.");
  }

  return {
    status: unsafeFields.length ? "failed" : "passed",
    unsafeFields,
    validationErrors
  };
}

if (process.argv[1]?.endsWith("run-restore-drill.ts")) {
  const evaluation = evaluateRestoreTargets({
    liveDatabaseUrl: process.env.DATABASE_URL,
    restoreDatabaseUrl: process.env.RESTORE_DATABASE_URL,
    liveBucket: process.env.OBJECT_STORAGE_BUCKET,
    restoreBucket: process.env.RESTORE_OBJECT_STORAGE_BUCKET,
    restorePrefix: process.env.RESTORE_OBJECT_STORAGE_PREFIX
  });

  console.log(JSON.stringify(evaluation, null, 2));
  if (evaluation.status !== "passed") {
    process.exitCode = 1;
  }
}
