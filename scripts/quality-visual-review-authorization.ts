import type { Queryable } from "../server/shared/database/client";

export const VISUAL_REVIEW_FIXTURE_ALLOW_ENV = "WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE";
export const VISUAL_REVIEW_FIXTURE_DATABASE_ENV = "WISEEFF_QUALITY_FIXTURE_DATABASE_NAME";

export function visualReviewFixtureConfigured(env: NodeJS.ProcessEnv = process.env) {
  return (
    env[VISUAL_REVIEW_FIXTURE_ALLOW_ENV] === "true" &&
    Boolean(env[VISUAL_REVIEW_FIXTURE_DATABASE_ENV]?.trim())
  );
}

export function assertVisualReviewFixtureConfigured(env: NodeJS.ProcessEnv = process.env) {
  if (!visualReviewFixtureConfigured(env)) {
    throw new Error(
      `Quality visual review fixture writes require ${VISUAL_REVIEW_FIXTURE_ALLOW_ENV}=true and ` +
        `${VISUAL_REVIEW_FIXTURE_DATABASE_ENV}=<owned database> on an isolated database.`
    );
  }
}

export async function assertVisualReviewFixtureDatabase(
  db: Queryable,
  env: NodeJS.ProcessEnv = process.env
) {
  assertVisualReviewFixtureConfigured(env);
  const expected = env[VISUAL_REVIEW_FIXTURE_DATABASE_ENV]!.trim();
  const result = await db.query<{ database_name: string }>(
    `select current_database()::text as database_name`
  );
  const actual = result.rows[0]?.database_name;
  if (actual !== expected) {
    throw new Error(
      `Quality visual review fixture expected owned database "${expected}", received "${actual ?? "unknown"}".`
    );
  }
}
