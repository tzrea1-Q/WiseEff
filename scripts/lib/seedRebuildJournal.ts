import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SeedRebuildState } from "./seedRebuild";
import { seedRebuildPlanSchema, confirmSeedRebuildPlan } from "./seedRebuildPlan";

const safeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/);
export const seedRebuildRunId = (value: unknown) => safeId.parse(value);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const text = z.string().min(1);
const preparationSchema = z.object({
  organizationId: text, actorUserId: text, expectedArtifactDigest: digest,
  identity: z.object({ runId: safeId, stage: z.enum(["vendor", "configuration-schema"]),
    candidateId: text, artifactId: text, releaseId: text, releaseVersion: text, publishedAt: z.string().datetime({ precision: 0 }),
    toolchain: z.object({ compiler: text, jsonSchemaDialect: text, sourceFormat: text }).strict(),
    definitions: z.array(z.object({ subjectId: text, propertyKey: text, definitionId: text, revisionId: text }).strict()),
    subjects: z.array(z.object({ canonicalKey: text, subjectId: text }).strict()).optional(),
  }).strict(),
  pins: z.object({ expectedCurrent: z.object({ id: text, digest, version: text.optional() }).strict(),
    predecessorArtifactDigest: digest, expectedArtifactDigest: digest,
    expectedVendorContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    expectedListedInputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), schemasRoot: text.optional(),
  }).strict(),
}).strict();
export type SeedRebuildPreparation = z.infer<typeof preparationSchema>;
export const parseSeedRebuildPreparation = (value: unknown) => preparationSchema.parse(value);
const stateSchema = z.object({
  version: z.literal(1), runId: safeId, plan: seedRebuildPlanSchema.extend({ digest }),
  phase: z.enum(["planned", "catalog", "archiving", "materializing", "disposing", "verified", "recovery-required"]),
  originalParameterDigest: digest, expectedIdentities: z.array(text),
  policy: z.object({ revision: z.number().int().nonnegative(), capabilityContractRevision: text.nullable(),
    lowRiskSingleActorPublish: z.boolean() }).strict(),
  baseline: z.object({
    schema: z.object({ digest, relations: z.array(z.object({ relation: text, relkind: text,
      columns: z.array(text), primaryKeyColumns: z.array(text) }).strict()) }).strict(),
    tables: z.array(z.object({ relation: text, mode: z.enum(["exact", "parameter-plane", "target-scoped",
      "append-only", "publication-append", "publication-window"]), keyColumns: z.array(text),
      ids: z.array(text).nullable(), count: z.number().int().nonnegative(), digest }).strict()),
    objects: z.array(z.object({ key: text, size: z.number().int().nonnegative(), digest }).strict()),
  }).strict(),
  archives: z.array(z.object({ projectId: z.enum(["atlas", "aurora", "nebula"]), archiveId: text, archiveDigest: digest }).strict()).max(3),
  publications: z.object(Object.fromEntries(["vendor", "configuration-schema"].map((stage) => [stage,
    z.object({ candidateId: text, artifactDigest: digest, releaseId: text,
      releaseDigest: z.union([digest, z.literal("")]), receiptId: text.optional() }).strict().optional()]))).strict(),
  preparedInputs: z.object({ vendor: preparationSchema.optional(), "configuration-schema": preparationSchema.optional() }).strict().optional(),
}).strict();

export function parseSeedRebuildState(value: unknown): SeedRebuildState {
  const state = stateSchema.parse(value) as SeedRebuildState;
  const { digest: _digest, ...payload } = state.plan;
  confirmSeedRebuildPlan(state.plan, state.plan.digest, payload);
  if (new Set(state.archives.map((item) => item.projectId)).size !== state.archives.length) {
    throw new Error("seed-rebuild-duplicate-archive-project");
  }
  return state;
}

export async function openSeedRebuildJournal(runDir: string) {
  if (!path.isAbsolute(runDir)) throw new Error("seed-rebuild-absolute-run-dir-required");
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  const stat = await lstat(runDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("seed-rebuild-private-run-dir-required");
  }
  const file = path.join(runDir, "core-state.json");
  return {
    async read(): Promise<SeedRebuildState> {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 32 * 1024 * 1024) {
        throw new Error("seed-rebuild-private-state-required");
      }
      return parseSeedRebuildState(JSON.parse(await readFile(file, "utf8")));
    },
    async save(state: SeedRebuildState) {
      const temp = `${file}.${randomUUID()}.tmp`;
      const handle = await open(temp, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        await rename(temp, file);
        const dir = await open(runDir, "r");
        try { await dir.sync(); } finally { await dir.close(); }
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(temp).catch(() => undefined);
        throw error;
      }
    },
  };
}

export async function assertSeedMaintenance(runDir: string, state: SeedRebuildState, publishing = false) {
  const proof = JSON.parse(await readFile(path.join(runDir, "wrapper-state.json"), "utf8"));
  if (proof.schemaVersion !== 1 || proof.runId !== state.runId || proof.planDigest !== state.plan.digest
    || proof.candidateSha !== state.plan.candidateSha || proof.organizationId !== state.plan.organizationId
    || proof.phase !== "maintenance-begun" || proof.recoveryPoint?.verified !== true
    || !/^sha256:[a-f0-9]{64}$/.test(proof.recoveryPoint?.manifestDigest ?? "")
    || proof.isolation?.proxyStopped !== true || proof.isolation?.queuePaused !== true
    || proof.isolation?.writersStopped !== true || proof.queue?.drained !== true
    || proof.publication?.frozen !== !publishing || (!publishing && proof.isolation?.managerStopped !== true)) {
    throw new Error("seed-rebuild-verified-maintenance-required");
  }
  return proof;
}
