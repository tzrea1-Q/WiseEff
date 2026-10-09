import { createReviewQueueReader, type ReviewQueueTrustedContext } from "../../parameter-governance/review";
import { mapReviewItem } from "../governance/dto";
import { captureCurrentCatalogPin } from "../../catalog-publication/runtime";
import { lookupProtectedIdentity } from "../../catalog-cutover/mapping";
import type { AuthContext } from "../../auth/types";
import { getRootPostgresPool, type Database } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";
import { boundedLegacyHeaders, CATALOG_SUNSET_HTTP_DATE, LEGACY_IDENTITY_CONTRACT,
  LEGACY_IDENTITY_WARNING, LEGACY_SPEC_CONTRACT, LEGACY_SPEC_WARNING } from "./headers";

export function historicalTaskReadWindow<Task extends { id: string; status: string }>(
  tasks: readonly Task[],
  family: "identity" | "spec",
) {
  const successor = "/parameter-admin/specs?review=open";
  return {
    body: {
      items: [] as Array<ReturnType<typeof mapReviewItem>>,
      historicalItems: tasks.map((task) => ({
        ...task, historicalOnly: true,
        needsCanonicalDecision: task.status === "open" || task.status === "dismissed", successor,
      })),
      successor,
    },
    headers: {
      ...boundedLegacyHeaders({
        sunsetHttpDate: CATALOG_SUNSET_HTTP_DATE,
        contract: family === "identity" ? LEGACY_IDENTITY_CONTRACT : LEGACY_SPEC_CONTRACT,
        warning: family === "identity" ? LEGACY_IDENTITY_WARNING : LEGACY_SPEC_WARNING,
      }),
      Link: `<${successor}>; rel="successor-version"`,
    },
  };
}

export async function readSpecTaskWindow<Task extends { id: string; status: string }>(
  db: Database, auth: AuthContext, tasks: readonly Task[],
) {
  const window = historicalTaskReadWindow(tasks, "spec");
  const pool = getRootPostgresPool(db);
  if (!pool || tasks.length === 0) return window;
  const exactTargets = new Map<string, { kind: string; id: string }>();
  for (const task of tasks.filter((entry) => entry.status === "open")) {
    const mapped = await lookupProtectedIdentity({
      client: pool,
      identity: {
        kind: "source-tuple", sourceSystem: "wiseeff-v1", sourceKind: "parameter-spec-review-task",
        ownerScopeKind: "organization", ownerScopeId: auth.organization.id, sourceId: task.id,
      },
    });
    if (!mapped.ok) {
      if (["PCAT-MAP-UNKNOWN-IDENTITY", "PCAT-MAP-UNMAPPED"].includes(mapped.error.code)) continue;
      throw new ApiError("CONFLICT", "The legacy task mapping cannot be read exactly.", { reason: mapped.error.code });
    }
    if (mapped.value.outcome === "mapped" &&
      ["review-item", "review-evidence"].includes(mapped.value.targetKind)) {
      exactTargets.set(task.id, { kind: mapped.value.targetKind, id: mapped.value.targetId });
    }
  }
  if (exactTargets.size === 0) return window;
  const pin = await captureCurrentCatalogPin(pool);
  if (!pin) throw new ApiError("CONFLICT", "The canonical Catalog release is unavailable.");
  const actorKind = auth.roles.some((role) => role.roleId === "platform-admin") ? "platform-admin"
    : auth.roles.some((role) => role.roleId === "admin") ? "org-admin" : "org-member";
  const context: ReviewQueueTrustedContext = actorKind === "platform-admin"
    ? { actorKind, principalId: auth.user.id }
    : { actorKind, organizationId: auth.organization.id, principalId: auth.user.id };
  const queue = await createReviewQueueReader(pool).list({
    organizationId: auth.organization.id, capturedRelease: pin,
    context,
  });
  if (!queue.ok) throw new ApiError(queue.error.kind === "permission-denied" ? "FORBIDDEN" : "CONFLICT",
    "Canonical Review Queue access was refused.", { reason: queue.error.kind });
  const adaptedIds = new Set<string>();
  for (const [taskId, target] of exactTargets) {
    const matches = queue.value.items.filter((item) => target.kind === "review-item"
      ? item.id === target.id : item.evidenceRefs.some((ref) => ref.id === target.id));
    if (matches.length !== 1) continue;
    adaptedIds.add(taskId);
    if (!window.body.items.some((item) => item.id === matches[0]!.id)) window.body.items.push(mapReviewItem(matches[0]!));
  }
  window.body.historicalItems = window.body.historicalItems.filter((task) => !adaptedIds.has(task.id));
  return window;
}
