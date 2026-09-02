import pg from "pg";

import type { IndependentCatalogSession } from "./sessions";

export type CatalogFailureKind =
  | "application-before-commit"
  | "deferred-constraint-at-commit";

export class CatalogCommitInjectedFailure extends Error {
  readonly kind: CatalogFailureKind = "application-before-commit";

  constructor(message = "injected catalog commit failure") {
    super(message);
    this.name = "CatalogCommitInjectedFailure";
  }
}

type FailureInjectable = Pick<
  IndependentCatalogSession,
  "query" | "begin" | "commit" | "rollback"
>;

/**
 * Run work inside a real transaction and force either an application abort
 * before COMMIT or a deferred-constraint failure at COMMIT. The session is
 * rolled back in both cases so callers can assert zero residue.
 */
export async function injectFailureAndRollback(
  session: FailureInjectable,
  kind: CatalogFailureKind,
  work: () => Promise<void>,
): Promise<Error> {
  await session.begin();
  try {
    await work();
    if (kind === "application-before-commit") {
      throw new CatalogCommitInjectedFailure();
    }
    await session.commit();
    throw new Error("Expected catalog COMMIT to fail under failure injection");
  } catch (error) {
    await session.rollback().catch(() => undefined);
    if (kind === "application-before-commit") {
      if (error instanceof CatalogCommitInjectedFailure) {
        return error;
      }
      throw error;
    }
    if (error instanceof pg.DatabaseError) {
      return error;
    }
    throw error;
  }
}
