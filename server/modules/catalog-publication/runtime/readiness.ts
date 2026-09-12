import pg from "pg";

import type { Database, Queryable } from "../../../shared/database/client";
import {
  isCatalogProjectionEmpty,
  readCurrentCatalogPointer,
} from "../../catalog-kernel/install/currentPointer";
import {
  readApprovedCatalogPublicationRuntime,
  readApprovedRuntimePin,
  type RuntimePinQuery,
} from "../../release-verification/report/runtimePin";
import { systemRetentionClock, type RetentionClock } from "../../release-verification/report/retention";
import { digestOf } from "../../release-verification/core/digest";
import { getPolicy } from "../persistence/store";
import type { ActivationReceiptKind } from "../persistence/types";
import { catalogConsumerSupportsRevision } from "./capabilities";
import {
  pinOf,
  type ApplicationFact,
  type CatalogPublicationFact,
  type DualFactNotReadyReason,
  type DualFactReadiness,
} from "./types";

export type DualFactReadinessQuery = {
  readonly dataMode: "new-empty" | "populated";
  readonly application?: RuntimePinQuery;
  readonly clock?: RetentionClock;
};

const asQueryable = (pool: pg.Pool): Queryable => ({
  query: async (text, values = []) => {
    const result = await pool.query(text, values);
    return { rows: result.rows, rowCount: result.rowCount };
  },
});

const loadCurrentReceipt = async (
  db: Queryable,
  releaseId: string,
  releaseDigest: string,
): Promise<{
  id: string;
  kind: ActivationReceiptKind;
  release_id: string;
  release_digest: string;
} | null> => {
  const result = await db.query<{
    id: string;
    kind: ActivationReceiptKind;
    release_id: string;
    release_digest: string;
  }>(
    `select id, kind, release_id, release_digest
       from parameter_catalog.catalog_activation_receipts
      where release_id = $1
        and release_digest = $2
      order by created_at desc, id desc
      limit 1`,
    [releaseId, releaseDigest],
  );
  return result.rows[0] ?? null;
};

const receiptCount = async (db: Queryable): Promise<number> => {
  const result = await db.query<{ n: string }>(
    `select count(*)::text as n from parameter_catalog.catalog_activation_receipts`,
  );
  return Number(result.rows[0]?.n ?? 0);
};

const loadMatchingArtifact = async (
  db: Queryable,
  digest: string,
): Promise<boolean> => {
  const result = await db.query<{ artifact_digest: string }>(
    `select artifact_digest
       from catalog_publication.release_artifacts
      where artifact_digest = $1`,
    [digest],
  );
  return result.rows[0]?.artifact_digest === digest;
};

const evaluateApplicationFact = async (
  db: Database | undefined,
  query: DualFactReadinessQuery,
  currentPin: { id: string; digest: string },
): Promise<{ fact?: ApplicationFact; reasons: DualFactNotReadyReason[] }> => {
  if (!query.application) {
    if (query.dataMode === "populated") {
      return { reasons: ["application-pin-absent"] };
    }
    return {
      fact: { kind: "new-empty-without-p13", claimsP13Retired: false },
      reasons: [],
    };
  }
  if (!db) {
    return { reasons: ["application-pin-absent"] };
  }
  const clock = query.clock ?? systemRetentionClock();
  const combo = await readApprovedCatalogPublicationRuntime(db, query.application, clock);
  if (combo.kind === "present") {
    const catalogPin = {
      id: combo.report.pins.catalog.releaseId,
      digest: combo.report.pins.catalog.releaseDigest,
    };
    if (
      digestOf(combo.report.pins) !== digestOf(query.application.pins) ||
      catalogPin.id !== currentPin.id ||
      catalogPin.digest !== currentPin.digest
    ) {
      return { reasons: ["application-pin-catalog-mismatch"] };
    }
    return {
      fact: {
        kind: "combo-catalog-publication-runtime",
        reportDigest: combo.report.digest,
        purpose: "catalog-publication-runtime",
        catalogPin: pinOf(catalogPin.id, catalogPin.digest),
      },
      reasons: [],
    };
  }
  const runtime = await readApprovedRuntimePin(db, query.application, clock);
  if (runtime.kind !== "present") {
    return { reasons: ["application-pin-absent"] };
  }
  const catalogPin = {
    id: runtime.report.pins.catalog.releaseId,
    digest: runtime.report.pins.catalog.releaseDigest,
  };
  if (catalogPin.id !== currentPin.id || catalogPin.digest !== currentPin.digest) {
    return { reasons: ["application-pin-catalog-mismatch"] };
  }
  return {
    fact: {
      kind: "approved-runtime-pin",
      reportDigest: runtime.report.digest,
      purpose: "post-retirement-runtime",
      catalogPin: pinOf(catalogPin.id, catalogPin.digest),
    },
    reasons: [],
  };
};

export const evaluateDualFactReadiness = async (
  pool: pg.Pool,
  query: DualFactReadinessQuery,
  applicationDb?: Database,
): Promise<DualFactReadiness> => {
  const db = asQueryable(pool);
  if (await isCatalogProjectionEmpty(pool)) {
    return { status: "unpublished", onlinePublicationReady: false };
  }
  const pointer = await readCurrentCatalogPointer(pool);
  if (pointer.kind !== "installed") {
    return {
      status: "not-ready",
      onlinePublicationReady: false,
      reasons: ["unpublished"],
      currentPin: null,
    };
  }
  const currentPin = { id: pointer.current.id, digest: pointer.current.digest };
  const policy = await getPolicy(db);
  const capabilityRevision = policy.ok ? policy.value.capabilityContractRevision : "";
  const reasons: DualFactNotReadyReason[] = [];
  if (!catalogConsumerSupportsRevision(capabilityRevision)) {
    reasons.push("unsupported-catalog-capability");
  }

  const receipts = await receiptCount(db);
  const receipt = await loadCurrentReceipt(db, currentPin.id, currentPin.digest);
  if (receipts === 0) {
    reasons.push("legacy-d1-without-receipt");
  } else if (!receipt) {
    reasons.push("missing-receipt");
  } else if (
    receipt.release_id !== currentPin.id ||
    receipt.release_digest !== currentPin.digest
  ) {
    reasons.push("receipt-pin-mismatch");
  }

  const artifactPresent = await loadMatchingArtifact(db, currentPin.digest);
  if (receipts > 0 && receipt && !artifactPresent && receipt.kind === "online-publication") {
    reasons.push("artifact-pin-mismatch");
  }

  const application = await evaluateApplicationFact(applicationDb, query, currentPin);
  reasons.push(...application.reasons);

  const catalog: CatalogPublicationFact | undefined = receipt
    ? {
        pin: pinOf(currentPin.id, currentPin.digest),
        receiptKind: receipt.kind,
        receiptId: receipt.id,
        artifactPresent,
        capabilityContractRevision: capabilityRevision,
      }
    : undefined;

  if (reasons.length > 0) {
    return {
      status: "not-ready",
      onlinePublicationReady: false,
      reasons,
      application: application.fact,
      catalog,
      currentPin: pinOf(currentPin.id, currentPin.digest),
    };
  }
  if (!application.fact || !catalog) {
    return {
      status: "not-ready",
      onlinePublicationReady: false,
      reasons: ["missing-receipt"],
      application: application.fact,
      catalog,
      currentPin: pinOf(currentPin.id, currentPin.digest),
    };
  }
  return {
    status: "ready",
    onlinePublicationReady: true,
    application: application.fact,
    catalog,
  };
};
