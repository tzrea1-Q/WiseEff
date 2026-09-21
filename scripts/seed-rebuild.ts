import { parseArgs } from "node:util";
import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createPostgresDatabase } from "../server/shared/database/client";
import { createObjectStoreFromEnv } from "../server/objectStoreFactory";
import { collectPublicationPolicyInstanceSnapshot } from "../server/modules/catalog-publication/authorization/instanceSnapshot";
import { planSeedRebuild, checkSeedRebuildState, rebuildSeedProjects, verifySeedRebuild, assertSeedPublicationIdle,
  captureSeedMaintenanceBaseline, verifySeedMaintenanceBaseline, assertSeedMaintenanceBaselineBinding,
  type SeedRebuildState } from "./lib/seedRebuild";
import { openSeedRebuildJournal, assertSeedMaintenance, seedRebuildRunId, parseSeedRebuildPreparation } from "./lib/seedRebuildJournal";
import { seedRebuildDigest } from "./lib/seedRebuildPlan";
import { prepareSeedCatalog, publishSeedCatalog, getSeedCatalogPublicationStatus,
  type SeedCatalogStage, type SeedCatalogPublicationResult } from "./lib/seedCatalogPublication";

const usage = `Reviewed example parameter rebuild. Run through ops/self-hosted/scripts/seed-rebuild.sh.
  plan --run-dir DIR --run-id ID --actor USER --organization-id ORG --candidate-sha SHA
  status --run-dir DIR
  maintenance-baseline --run-dir DIR --confirm-plan DIGEST --candidate-sha SHA
  catalog-prepare --run-dir DIR --stage vendor|configuration-schema --confirm-plan DIGEST --candidate-sha SHA
  catalog-publish --run-dir DIR --stage STAGE --actor REVIEWER --confirm-artifact DIGEST --confirm-plan DIGEST --candidate-sha SHA
  catalog-status --run-dir DIR --stage STAGE --confirm-plan DIGEST --candidate-sha SHA
  rebuild|verify --run-dir DIR --confirm-plan DIGEST --candidate-sha SHA
No policy changes, capability grants, password changes or service control occur in this core.`;

function unwrap<T>(result: SeedCatalogPublicationResult<T>): T {
  if (!result.ok) throw new Error(`seed-rebuild-catalog-${result.error.kind}:${result.error.message}`);
  return result.value;
}

export async function runSeedRebuildCli(argv: string[]) {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, strict: true, options:
    Object.fromEntries(["run-dir", "run-id", "actor", "organization-id", "candidate-sha", "stage", "confirm-plan", "confirm-artifact"]
      .map((key) => [key, { type: "string" as const }])) });
  const command = positionals[0];
  if (command === "help" || !command) return { help: usage };
  if (positionals.length !== 1 || !["plan", "status", "maintenance-baseline", "catalog-prepare", "catalog-publish", "catalog-status", "rebuild", "verify"].includes(command)) {
    throw new Error("seed-rebuild-command-invalid");
  }
  const required = (key: string) => {
    const value = values[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`seed-rebuild-argument-required:${key}`);
    return value;
  };
  const runDir = required("run-dir");
  const journal = await openSeedRebuildJournal(runDir);
  if (command === "status") {
    const state = await journal.read();
    return { ok: true, runId: state.runId, phase: state.phase, plan: state.plan, publications: state.publications,
      recoveryRequired: ["archiving", "materializing", "disposing", "recovery-required"].includes(state.phase) };
  }
  // Host lock serializes other operations. This local lock additionally refuses simultaneous direct invocations.
  const lockPath = path.join(runDir, ".core.lock");
  const lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("seed-rebuild-core-lock-or-recovery-required"); });
  const url = process.env.WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL;
  if (!url || process.env.WISEEFF_API_PROCESS === "1") {
    await lock.close(); await unlink(lockPath);
    throw new Error("seed-rebuild-one-shot-management-identity-required");
  }
  const db = createPostgresDatabase(url);
  try {
    if (process.env.OBJECT_STORE_MODE !== "s3" && process.env.OBJECT_STORE_MODE !== "local") throw new Error("seed-rebuild-object-store-required");
    const store = createObjectStoreFromEnv({ ...process.env, OBJECT_STORE_MODE: process.env.OBJECT_STORE_MODE,
      OBJECT_STORE_ROOT: process.env.OBJECT_STORE_ROOT ?? "" });
    const ctx = { db, store, repoRoot: process.cwd() };
    if (command === "plan") {
      const existing = await lstat(path.join(runDir, "core-state.json")).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
      if (existing) throw new Error("seed-rebuild-run-already-exists");
      const state = await planSeedRebuild(ctx, { runId: seedRebuildRunId(required("run-id")),
        organizationId: required("organization-id"), actorUserId: required("actor"), candidateSha: required("candidate-sha") });
      await journal.save(state);
      return { ok: true, writes: false, plan: state.plan, expectedBindings: state.expectedIdentities.length,
        policy: state.policy, nextAction: "review-plan-and-begin-maintenance" };
    }
    const state = await journal.read();
    const confirmed = required("confirm-plan");
    await checkSeedRebuildState(ctx, state, confirmed, required("candidate-sha"));
    if (["archiving", "materializing", "disposing", "recovery-required"].includes(state.phase)) {
      throw new Error("seed-rebuild-recovery-required");
    }
    const snapshot = await collectPublicationPolicyInstanceSnapshot(db);
    if (command === "maintenance-baseline") {
      const proof = await assertSeedMaintenance(runDir, state);
      if (!snapshot.frozen) throw new Error("seed-rebuild-publication-freeze-required");
      const checkpoint = await captureSeedMaintenanceBaseline(ctx, state, proof.recoveryPoint.manifestDigest);
      if (!state.maintenanceBaseline) {
        state.maintenanceBaseline = checkpoint;
        await journal.save(state);
      }
      return { ok: true, status: "maintenance-baseline-recorded", digest: checkpoint.digest,
        runId: checkpoint.runId, planDigest: checkpoint.planDigest, manifestDigest: checkpoint.manifestDigest };
    }
    if (command !== "catalog-status") await verifySeedMaintenanceBaseline(ctx, state);
    if (command === "verify" || command === "rebuild") {
      await assertSeedMaintenance(runDir, state);
      if (!snapshot.frozen) throw new Error("seed-rebuild-publication-freeze-required");
      const result = command === "verify" ? await verifySeedRebuild(ctx, state)
        : await rebuildSeedProjects(ctx, state, journal.save);
      if (state.phase !== "verified") throw new Error("seed-rebuild-completion-not-recorded");
      return { ok: true, status: "verified", backendVerified: true, phase: state.phase, ...result };
    }
    const stage = required("stage") as SeedCatalogStage;
    if (stage !== "vendor" && stage !== "configuration-schema") throw new Error("seed-rebuild-stage-invalid");
    const existing = state.publications[stage];
    if (command === "catalog-status") {
      if (!existing) throw new Error("seed-rebuild-candidate-not-prepared");
      const observed = unwrap(await getSeedCatalogPublicationStatus({ db, candidateId: existing.candidateId,
        expectedRunId: state.runId, expectedStage: stage }));
      if (observed.artifactDigest !== existing.artifactDigest || observed.releaseId !== existing.releaseId) {
        throw new Error("seed-rebuild-candidate-drift");
      }
      if (observed.receiptId) {
        existing.receiptId = observed.receiptId;
        existing.releaseDigest = observed.receiptReleaseDigest!;
        await journal.save(state);
      }
      return { ok: true, status: observed.receiptId ? "succeeded" : observed.jobStatus ?? "prepared",
        receipt: observed.receiptId ? { id: observed.receiptId, releaseId: observed.receiptReleaseId, releaseDigest: observed.receiptReleaseDigest } : null,
        ...observed };
    }
    const publishing = command === "catalog-publish";
    await assertSeedMaintenance(runDir, state, publishing);
    if (snapshot.frozen === publishing) throw new Error("seed-rebuild-freeze-state-mismatch");
    const previous = stage === "vendor" ? state.plan.catalog : state.publications.vendor;
    if (!previous || (stage === "configuration-schema" && !state.publications.vendor?.receiptId)) {
      throw new Error("seed-rebuild-predecessor-receipt-required");
    }
    const pin = stage === "vendor" ? state.plan.catalog
      : { id: state.publications.vendor!.releaseId, digest: state.publications.vendor!.releaseDigest };
    if (publishing) {
      if (!existing || required("confirm-artifact") !== existing.artifactDigest) throw new Error("seed-rebuild-artifact-confirmation-required");
      await assertSeedPublicationIdle(db, existing.candidateId);
      const observed = unwrap(await getSeedCatalogPublicationStatus({ db, candidateId: existing.candidateId,
        expectedRunId: state.runId, expectedStage: stage }));
      if (observed.receiptId) {
        if (observed.artifactDigest !== existing.artifactDigest || observed.receiptReleaseId !== existing.releaseId
          || snapshot.currentReleaseId !== observed.receiptReleaseId || snapshot.currentReleaseDigest !== observed.receiptReleaseDigest) {
          throw new Error("seed-rebuild-publication-receipt-drift");
        }
        existing.receiptId = observed.receiptId;
        existing.releaseDigest = observed.receiptReleaseDigest!;
        await journal.save(state);
        return { ok: true, status: "succeeded", receipt: { id: observed.receiptId }, ...observed };
      }
      if (snapshot.currentReleaseId !== pin.id || snapshot.currentReleaseDigest !== pin.digest) throw new Error("seed-rebuild-current-pin-drift");
      const queued = unwrap(await publishSeedCatalog({ db, organizationId: state.plan.organizationId,
        actorUserId: required("actor"), runId: state.runId, stage, candidateId: existing.candidateId,
        expectedArtifactDigest: existing.artifactDigest, expectedCurrent: pin,
        idempotencyKey: `seed-rebuild:${state.runId}:${stage}` }));
      return { ok: true, status: queued.jobStatus, ...queued };
    }
    if (snapshot.currentReleaseId !== pin.id || snapshot.currentReleaseDigest !== pin.digest) throw new Error("seed-rebuild-current-pin-drift");
    if (existing) return { ok: true, status: "prepared", ...existing };
    // Persist frozen inputs before the native candidate write. A retry uses these exact identities.
    const preparedInput = await frozenPreparation(db, state, stage, pin, snapshot.artifactDigest!);
    state.preparedInputs ??= {};
    state.preparedInputs[stage] = preparedInput;
    state.phase = "catalog";
    await journal.save(state);
    const prepared = unwrap(await prepareSeedCatalog({ ...preparedInput, db }));
    state.publications[stage] = { candidateId: prepared.candidateId, artifactDigest: prepared.artifactDigest,
      releaseId: prepared.releaseId, releaseDigest: "" };
    await journal.save(state);
    return { ok: true, status: "prepared", ...prepared, nextAction: "review-artifact-and-publish-with-authorized-reviewer" };
  } finally {
    await db.close(); await lock.close(); await unlink(lockPath);
  }
}

export async function frozenPreparation(db: ReturnType<typeof createPostgresDatabase>, state: SeedRebuildState,
  stage: SeedCatalogStage, pin: { id: string; digest: string }, artifactDigest: string) {
  assertSeedMaintenanceBaselineBinding(state);
  const stored = state.preparedInputs?.[stage];
  // The publication helper supplies the reviewed owner's frozen allocation; no parallel builder here.
  const { freezeSeedCatalogIdentity } = await import("./lib/seedCatalogPublication");
  const token = createHash("sha256").update(`${state.runId}:${state.plan.digest}:${stage}`).digest("hex").slice(0, 24);
  const rebuilt = unwrap(await freezeSeedCatalogIdentity({ db, organizationId: state.plan.organizationId,
    actorUserId: state.plan.actorUserId, runId: state.runId, stage, expectedCurrent: pin,
    predecessorArtifactDigest: artifactDigest, schemasRoot: path.join(process.cwd(), "schemas/dts"),
    candidateId: `ccand_seed_${token}`, artifactId: `cart_seed_${token}`, releaseId: `crel_seed_${token}`,
    releaseVersion: `${stage === "vendor" ? "2.0.0" : "2.1.0"}-seed.${token}`,
    publishedAt: stored?.identity.publishedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z") }));
  // Rebuild every frozen field from the sealed run, live predecessor and reviewed
  // sources. The journal supplies only the original timestamp for exact retry.
  const persisted = parseSeedRebuildPreparation(JSON.parse(JSON.stringify(rebuilt)));
  if (stored && seedRebuildDigest(stored) !== seedRebuildDigest(persisted)) {
    throw new Error("seed-rebuild-preparation-drift");
  }
  return persisted;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSeedRebuildCli(process.argv.slice(2)).then((value) => console.log(JSON.stringify(value))).catch((error: unknown) => {
    const message = error instanceof Error && /^seed-rebuild-[a-z-]+(?::[a-zA-Z0-9:, _.-]+)?$/.test(error.message)
      ? error.message : "seed-rebuild-operation-failed";
    console.error(JSON.stringify({ ok: false, error: message }));
    process.exitCode = 1;
  });
}
