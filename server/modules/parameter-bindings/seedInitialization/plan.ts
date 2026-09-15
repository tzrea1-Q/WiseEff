/**
 * Issue #849 PU-04 (decision 17): narrow, explicit seed scope.
 *
 * Resolves the reviewed seed projects by their stable identifiers, verifies
 * organization ownership, and blocks the plan rather than silently creating or
 * guessing a project. Only Atlas, Aurora and Nebula may be seeded; every other
 * project in the organization is reported as excluded and keeps its unrelated
 * business state.
 *
 * This module never writes parameter data, never creates a project and never
 * invents an approval. It produces the plan that a later, separately authorized
 * materialization step consumes.
 */
import type { Database, Queryable } from "../../../shared/database/client";

/** Stable seed identifiers from `src/config/power-management.json` -> `projects`. */
export const SEED_PROJECT_IDS = Object.freeze(["atlas", "aurora", "nebula"] as const);
export type SeedProjectId = (typeof SEED_PROJECT_IDS)[number];

export const SEED_INITIALIZATION_SCOPE = "atlas-aurora-nebula";

export type SeedProjectBlockReason =
  | "missing-project"
  | "identity-ambiguous"
  | "organization-mismatch";

export type SeedProjectIdentity = {
  readonly id: string;
  readonly name: string;
  readonly code: string;
};

export type SeedInitializationTarget = {
  readonly projectId: string;
  readonly name: string;
  readonly code: string;
  readonly organizationId: string;
  /** `initialized` when the project already owns canonical bindings. */
  readonly parameterState: "empty" | "initialized";
  readonly bindingCount: number;
};

export type SeedInitializationBlock = {
  readonly projectId: string;
  readonly reason: SeedProjectBlockReason;
  readonly detail: string;
};

export type SeedInitializationPlan = {
  readonly organizationId: string;
  readonly seedDigest: string;
  readonly scope: typeof SEED_INITIALIZATION_SCOPE;
  readonly targets: readonly SeedInitializationTarget[];
  /** Projects in this organization that the seed run must not touch. */
  readonly excludedProjectIds: readonly string[];
  readonly blocked: readonly SeedInitializationBlock[];
};

export class SeedInitializationBlockedError extends Error {
  constructor(readonly blocks: readonly SeedInitializationBlock[]) {
    super(
      `Seed initialization target plan is blocked: ${blocks
        .map((block) => `${block.projectId}(${block.reason})`)
        .join(", ")}`,
    );
    this.name = "SeedInitializationBlockedError";
  }
}

export type SeedInitializationPlanInput = {
  readonly organizationId: string;
  readonly seedDigest: string;
  /** Injectable so the plan can be exercised without the repository seed file. */
  readonly seedProjects?: readonly SeedProjectIdentity[];
};

/**
 * Resolve the three reviewed projects by stable id and organization ownership.
 *
 * A missing project, a duplicate identity inside the organization, or a project
 * whose stored code disagrees with the reviewed seed identity all block the plan.
 */
export async function resolveSeedInitializationPlan(
  db: Queryable,
  input: SeedInitializationPlanInput,
): Promise<SeedInitializationPlan> {
  const seedProjects = input.seedProjects ?? SEED_PROJECT_IDENTITIES;
  const targets: SeedInitializationTarget[] = [];
  const blocked: SeedInitializationBlock[] = [];
  const seededProjectIds: string[] = [];

  for (const seedProject of seedProjects) {
    const rows = await db.query<{ id: string; name: string; code: string; organization_id: string }>(
      `
      select id, name, code, organization_id
        from public.projects
       where id = $1
       order by organization_id
      `,
      [seedProject.id],
    );

    if (rows.rows.length === 0) {
      blocked.push({
        projectId: seedProject.id,
        reason: "missing-project",
        detail: "Reviewed seed project does not exist; a reviewed manifest change is required.",
      });
      continue;
    }
    if (rows.rows.length > 1) {
      blocked.push({
        projectId: seedProject.id,
        reason: "identity-ambiguous",
        detail: "Stable seed id resolves to more than one project.",
      });
      continue;
    }

    const row = rows.rows[0]!;
    if (row.organization_id !== input.organizationId) {
      blocked.push({
        projectId: seedProject.id,
        reason: "organization-mismatch",
        detail: "Seed project belongs to a different organization.",
      });
      continue;
    }
    if (row.code.trim() !== seedProject.code.trim()) {
      blocked.push({
        projectId: seedProject.id,
        reason: "identity-ambiguous",
        detail: `Stored code '${row.code}' disagrees with the reviewed seed code '${seedProject.code}'.`,
      });
      continue;
    }

    const bindings = await db.query<{ count: string }>(
      `
      select count(*)::text as count
        from parameter_catalog.project_parameter_bindings
       where organization_id = $1
         and project_id = $2
      `,
      [input.organizationId, seedProject.id],
    );
    const bindingCount = Number(bindings.rows[0]?.count ?? "0");

    targets.push({
      projectId: row.id,
      name: row.name,
      code: row.code,
      organizationId: row.organization_id,
      parameterState: bindingCount > 0 ? "initialized" : "empty",
      bindingCount,
    });
    seededProjectIds.push(row.id);
  }

  const others = await db.query<{ id: string }>(
    `select id from public.projects where organization_id = $1 order by id`,
    [input.organizationId],
  );
  const excludedProjectIds = others.rows
    .map((row) => row.id)
    .filter((id) => !seededProjectIds.includes(id));

  return {
    organizationId: input.organizationId,
    seedDigest: input.seedDigest,
    scope: SEED_INITIALIZATION_SCOPE,
    targets,
    excludedProjectIds,
    blocked,
  };
}

/** Fail closed: a blocked plan must never be materialized. */
export function assertSeedInitializationPlanApplicable(plan: SeedInitializationPlan): void {
  if (plan.blocked.length > 0) {
    throw new SeedInitializationBlockedError(plan.blocked);
  }
  if (plan.targets.length !== SEED_PROJECT_IDS.length) {
    throw new SeedInitializationBlockedError(
      SEED_PROJECT_IDS.filter(
        (id) => !plan.targets.some((target) => target.projectId === id),
      ).map((id) => ({
        projectId: id,
        reason: "missing-project" as const,
        detail: "Reviewed seed project was not resolved into the target plan.",
      })),
    );
  }
}

/**
 * Reviewed seed identities. Mirrors `src/config/power-management.json#projects`;
 * `seedInitializationPlan.test.ts` fails if the two drift, so this stays a copy of
 * the reviewed manifest rather than a second source of truth.
 */
export const SEED_PROJECT_IDENTITIES: readonly SeedProjectIdentity[] = Object.freeze([
  { id: "aurora", name: "Aurora 量产平台", code: "AUR-Prod" },
  { id: "nebula", name: "Nebula 高频调试项目", code: "NEB-RD" },
  { id: "atlas", name: "Atlas 海外交付项目", code: "ATL-Intl" }
]);

export type SeedInitializationRunStatus = "planned" | "running" | "completed" | "failed";

export type SeedInitializationRun = {
  readonly organizationId: string;
  readonly seedDigest: string;
  readonly status: SeedInitializationRunStatus;
  readonly targetProjectIds: readonly string[];
};

/** Journal a plan or an outcome. The same digest is one run, never two. */
export async function recordSeedInitializationRun(
  db: Queryable,
  input: {
    organizationId: string;
    seedDigest: string;
    status: SeedInitializationRunStatus;
    targetProjectIds: readonly string[];
    blocked?: readonly SeedInitializationBlock[];
    startedByUserId?: string | null;
  },
): Promise<void> {
  await db.query(
    `
    insert into seed_initialization_runs (
      organization_id, seed_digest, status, scope, target_project_ids, blocked,
      started_by_user_id, completed_at
    ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7,
              case when $3 = 'completed' then now() else null end)
    on conflict (organization_id, seed_digest) do update
       set status = excluded.status,
           target_project_ids = excluded.target_project_ids,
           blocked = excluded.blocked,
           completed_at = case when excluded.status = 'completed' then now() else null end,
           updated_at = now()
    `,
    [
      input.organizationId,
      input.seedDigest,
      input.status,
      SEED_INITIALIZATION_SCOPE,
      JSON.stringify([...input.targetProjectIds]),
      JSON.stringify([...(input.blocked ?? [])]),
      input.startedByUserId ?? null,
    ],
  );
}

export async function getSeedInitializationRun(
  db: Queryable,
  input: { organizationId: string; seedDigest: string },
): Promise<SeedInitializationRun | null> {
  const result = await db.query<{
    organization_id: string;
    seed_digest: string;
    status: SeedInitializationRunStatus;
    target_project_ids: unknown;
  }>(
    `
    select organization_id, seed_digest, status, target_project_ids
      from seed_initialization_runs
     where organization_id = $1
       and seed_digest = $2
     limit 1
    `,
    [input.organizationId, input.seedDigest],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    organizationId: row.organization_id,
    seedDigest: row.seed_digest,
    status: row.status,
    targetProjectIds: Array.isArray(row.target_project_ids)
      ? (row.target_project_ids as string[])
      : [],
  };
}

/**
 * The same completed seed run is a no-op: a retry must not reseed or reset project
 * values, and an ordinary startup or upgrade never records a run at all.
 */
export async function seedInitializationRunIsComplete(
  db: Queryable,
  input: { organizationId: string; seedDigest: string },
): Promise<boolean> {
  const run = await getSeedInitializationRun(db, input);
  return run?.status === "completed";
}
