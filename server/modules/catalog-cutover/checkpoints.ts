import { createHash, randomUUID } from "node:crypto";

import type pg from "pg";

import {
  PRE_ACTIVATION_PHASES,
  UNAVAILABLE_PHASES,
  type CutoverCheckpoint,
  type CutoverFailure,
  type CutoverPlan,
  type CutoverResult,
  type CutoverRunSnapshot,
  type CutoverRunState,
  type PreActivationPhase,
} from "./interface";

export type CutoverQueryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;

const PHASE_SET = new Set<string>(PRE_ACTIVATION_PHASES);
const UNAVAILABLE_SET = new Set<string>(UNAVAILABLE_PHASES);

export const fail = <T>(code: CutoverFailure["code"], detail: string): CutoverResult<T> => ({
  ok: false,
  error: { code, detail },
});

export const ok = <T>(value: T): CutoverResult<T> => ({ ok: true, value });

export const isPreActivationPhase = (phase: string): phase is PreActivationPhase =>
  PHASE_SET.has(phase);

export const assertAllowedPhase = (phase: string): CutoverResult<PreActivationPhase> => {
  if (UNAVAILABLE_SET.has(phase)) {
    return fail(
      "PCAT-ORC-ACTIVATION-UNAVAILABLE",
      `Activation phase ${phase} is unavailable on the pre-activation cutover seam`,
    );
  }
  if (!isPreActivationPhase(phase)) {
    return fail("PCAT-ORC-UNKNOWN-PHASE", `Unknown cutover phase ${phase}`);
  }
  return ok(phase);
};

export const mintCutoverRunId = (): string => `cutover_${randomUUID()}`;

export const mintCutoverEventId = (): string => `cevt_${randomUUID()}`;

export const checkpointDigestFor = (
  phase: PreActivationPhase,
  payload: Readonly<Record<string, unknown>>,
): string => {
  const canonical = JSON.stringify({
    phase,
    payload,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
};

type RunRow = {
  id: string;
  plan_digest: string;
  current_phase: string;
  state: string;
};

type CheckpointRow = {
  phase: string;
  checkpoint_digest: string;
  payload: Record<string, unknown>;
  committed_at: Date;
};

const asRunState = (value: string): CutoverRunState => {
  if (
    value === "planned" ||
    value === "running" ||
    value === "failed" ||
    value === "completed" ||
    value === "recovery-required"
  ) {
    return value;
  }
  return "failed";
};

export const loadRunByPlanDigest = async (
  client: CutoverQueryable,
  planDigest: string,
): Promise<RunRow | null> => {
  const result = await client.query<RunRow>(
    `
    select id, plan_digest, current_phase, state
      from parameter_catalog.parameter_catalog_cutover_runs
     where plan_digest = $1
     order by created_at asc
     limit 1
    `,
    [planDigest],
  );
  return result.rows[0] ?? null;
};

export const loadRunById = async (
  client: CutoverQueryable,
  runId: string,
): Promise<RunRow | null> => {
  const result = await client.query<RunRow>(
    `
    select id, plan_digest, current_phase, state
      from parameter_catalog.parameter_catalog_cutover_runs
     where id = $1
    `,
    [runId],
  );
  return result.rows[0] ?? null;
};

export const insertPlannedRun = async (
  client: CutoverQueryable,
  input: {
    readonly runId: string;
    readonly plan: CutoverPlan;
  },
): Promise<RunRow> => {
  await client.query(
    `
    insert into parameter_catalog.parameter_catalog_cutover_runs (
      id, source_snapshot_fingerprint, target_artifact_sha,
      target_catalog_release_digest, migration_contract_version,
      plan_digest, current_phase, state
    ) values ($1, $2, $3, $4, $5, $6, 'P0', 'planned')
    on conflict (source_snapshot_fingerprint, target_artifact_sha, target_catalog_release_digest, migration_contract_version, plan_digest)
    do nothing
    `,
    [
      input.runId,
      input.plan.sourceSnapshotFingerprint,
      input.plan.targetArtifactSha,
      input.plan.targetCatalogReleaseDigest,
      input.plan.migrationContractVersion,
      input.plan.planDigest,
    ],
  );
  const stored = await loadRunByPlanDigest(client, input.plan.planDigest);
  if (!stored) {
    throw new Error("cutover run insert failed");
  }
  return stored;
};

export const updateRunProgress = async (
  client: CutoverQueryable,
  input: {
    readonly runId: string;
    readonly phase: PreActivationPhase;
    readonly state: CutoverRunState;
  },
): Promise<void> => {
  await client.query(
    `
    update parameter_catalog.parameter_catalog_cutover_runs
       set current_phase = $2,
           state = $3,
           updated_at = now()
     where id = $1
    `,
    [input.runId, input.phase, input.state],
  );
};

export const nextEventSequence = async (
  client: CutoverQueryable,
  runId: string,
): Promise<number> => {
  const result = await client.query<{ n: string }>(
    `
    select coalesce(max(sequence_number), 0)::text as n
      from parameter_catalog.parameter_catalog_cutover_events
     where cutover_run_id = $1
    `,
    [runId],
  );
  return Number(result.rows[0]?.n ?? 0) + 1;
};

export const appendCutoverEvent = async (
  client: CutoverQueryable,
  input: {
    readonly runId: string;
    readonly phase: PreActivationPhase;
    readonly eventKind: string;
    readonly payload: Readonly<Record<string, unknown>>;
  },
): Promise<void> => {
  const sequence = await nextEventSequence(client, input.runId);
  await client.query(
    `
    insert into parameter_catalog.parameter_catalog_cutover_events (
      id, cutover_run_id, sequence_number, phase, event_kind, payload
    ) values ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      mintCutoverEventId(),
      input.runId,
      sequence,
      input.phase,
      input.eventKind,
      JSON.stringify(input.payload),
    ],
  );
};

export const persistCheckpoint = async (
  client: CutoverQueryable,
  input: {
    readonly runId: string;
    readonly phase: string;
    readonly payload: Readonly<Record<string, unknown>>;
  },
): Promise<CutoverResult<CutoverCheckpoint>> => {
  const allowed = assertAllowedPhase(input.phase);
  if (!allowed.ok) return allowed;
  const digest = checkpointDigestFor(allowed.value, input.payload);
  await client.query(
    `
    insert into parameter_catalog.parameter_catalog_cutover_checkpoints (
      cutover_run_id, phase, checkpoint_digest, payload
    ) values ($1, $2, $3, $4::jsonb)
    on conflict (cutover_run_id, phase)
    do nothing
    `,
    [input.runId, allowed.value, digest, JSON.stringify(input.payload)],
  );
  const stored = await client.query<CheckpointRow>(
    `
    select phase, checkpoint_digest, payload, committed_at
      from parameter_catalog.parameter_catalog_cutover_checkpoints
     where cutover_run_id = $1 and phase = $2
    `,
    [input.runId, allowed.value],
  );
  const row = stored.rows[0];
  if (!row) {
    return fail("PCAT-ORC-PHASE-FAILED", `Failed to persist checkpoint ${allowed.value}`);
  }
  await appendCutoverEvent(client, {
    runId: input.runId,
    phase: allowed.value,
    eventKind: "checkpoint",
    payload: { checkpointDigest: row.checkpoint_digest },
  });
  return ok({
    phase: allowed.value,
    checkpointDigest: row.checkpoint_digest,
    payload: row.payload,
    committedAt: row.committed_at.toISOString(),
  });
};

export const loadCheckpoints = async (
  client: CutoverQueryable,
  runId: string,
): Promise<readonly CutoverCheckpoint[]> => {
  const result = await client.query<CheckpointRow>(
    `
    select phase, checkpoint_digest, payload, committed_at
      from parameter_catalog.parameter_catalog_cutover_checkpoints
     where cutover_run_id = $1
     order by phase
    `,
    [runId],
  );
  const byPhase = new Map<string, CutoverCheckpoint>();
  for (const row of result.rows) {
    if (!isPreActivationPhase(row.phase)) continue;
    byPhase.set(row.phase, {
      phase: row.phase,
      checkpointDigest: row.checkpoint_digest,
      payload: row.payload,
      committedAt: row.committed_at.toISOString(),
    });
  }
  return PRE_ACTIVATION_PHASES.filter((phase) => byPhase.has(phase)).map(
    (phase) => byPhase.get(phase)!,
  );
};

export const lastCheckpointPhase = (
  checkpoints: readonly CutoverCheckpoint[],
): PreActivationPhase =>
  checkpoints.length === 0 ? "P0" : checkpoints[checkpoints.length - 1]!.phase;

export const snapshotFromRun = async (
  client: CutoverQueryable,
  run: RunRow,
  resumed: boolean,
): Promise<CutoverRunSnapshot> => {
  const checkpoints = await loadCheckpoints(client, run.id);
  const p3 = checkpoints.find((row) => row.phase === "P3");
  const token =
    typeof p3?.payload.runBoundToken === "string" ? p3.payload.runBoundToken : null;
  const dump = typeof p3?.payload.dump === "string" ? p3.payload.dump : null;
  const currentPhase = isPreActivationPhase(run.current_phase)
    ? run.current_phase
    : lastCheckpointPhase(checkpoints);
  return {
    runId: run.id,
    planDigest: run.plan_digest,
    currentPhase,
    state: asRunState(run.state),
    resumed,
    liveRun: run.state === "running",
    checkpoints,
    runBoundToken: token,
    recoveryPointDump: dump,
  };
};

export const countLiveRuns = async (
  client: CutoverQueryable,
  planDigest: string,
): Promise<number> => {
  const result = await client.query<{ n: string }>(
    `
    select count(*)::text as n
      from parameter_catalog.parameter_catalog_cutover_runs
     where plan_digest = $1 and state = 'running'
    `,
    [planDigest],
  );
  return Number(result.rows[0]?.n ?? 0);
};
