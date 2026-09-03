import type {
  ListReviewQueueQuery,
  Result,
  ReviewQueueFailure,
  ReviewQueueTrustedContext,
} from "./types";

const isUsableToken = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.trim() === value &&
  !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

const permissionDenied = (
  actorKind: ReviewQueueTrustedContext["actorKind"],
): Result<never, ReviewQueueFailure> => ({
  ok: false,
  error: { kind: "permission-denied", actorKind },
});

export const authorizeReviewQueueRead = (
  query: Pick<ListReviewQueueQuery, "organizationId" | "context">,
): Result<void, ReviewQueueFailure> => {
  if (!isUsableToken(query.organizationId)) {
    return { ok: false, error: { kind: "invalid-query", reason: "organizationId" } };
  }
  const context = query.context;
  if (!context || !("actorKind" in context)) {
    return permissionDenied("anonymous");
  }
  if (context.actorKind !== "org-admin") {
    return permissionDenied(context.actorKind);
  }
  if (!isUsableToken(context.principalId) || !isUsableToken(context.organizationId)) {
    return permissionDenied(context.actorKind);
  }
  if (context.organizationId !== query.organizationId) {
    return permissionDenied(context.actorKind);
  }
  return { ok: true, value: undefined };
};
