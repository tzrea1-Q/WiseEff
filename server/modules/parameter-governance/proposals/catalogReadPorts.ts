import type pg from "pg";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import { loadProjection } from "../../catalog-kernel/runtime/currentSnapshot";
import { CatalogPageLimit, CatalogReleaseDigest, CatalogReleaseId, type CatalogReleasePin } from "../../parameter-catalog-contract/index";

type Session = Pick<pg.PoolClient, "query">;
export class ProposalReadTargetError extends Error {
  constructor(readonly reason: "read-target-unavailable" | "read-target-mismatch") {
    super(reason);
    this.name = "ProposalReadTargetError";
  }
}
export const readDatabaseIdentity = async (session: Session): Promise<string> => {
  try {
    const identity = (await session.query<{ identity: string }>("select parameter_catalog.runtime_database_identity() as identity")).rows[0]?.identity;
    if (!identity || !/^\d+:\d+$/.test(identity)) throw new Error();
    return identity;
  } catch { throw new ProposalReadTargetError("read-target-unavailable"); }
};

/** One leased reader session, paired with the writer before any mutation. */
export function createProposalCatalogReadPorts(reader: Session) {
  const snapshots = new Map<string, Awaited<ReturnType<typeof loadProjection>>>();
  const releasePin = async (releaseId: string): Promise<CatalogReleasePin | null> => {
    const row = (await reader.query<{ release_digest: string }>("select release_digest from parameter_catalog.catalog_releases where id=$1", [releaseId])).rows[0];
    return row ? { id: CatalogReleaseId(releaseId), digest: CatalogReleaseDigest(row.release_digest) } : null;
  };
  return {
    async currentRelease(): Promise<CatalogReleasePin | null> {
      const pointer = await readCurrentCatalogPointer(reader);
      return pointer.kind === "installed" ? { id: pointer.current.id, digest: pointer.current.digest } : null;
    },
    releasePin,
    async revisionInRelease(releaseId: string, revisionId: string) {
      const pin = await releasePin(releaseId);
      if (!pin) return null;
      if (!snapshots.has(releaseId)) snapshots.set(releaseId, await loadProjection(reader, releaseId, "pinned", pin));
      const snapshot = snapshots.get(releaseId)?.snapshot;
      if (!snapshot) return null;
      let after: Parameters<typeof snapshot.listDefinitions>[0]["page"]["after"] = { kind: "absent" };
      do {
        const page = snapshot.listDefinitions({ selection: { kind: "all" }, scope: { kind: "all" },
          lifecycles: ["active", "deprecated", "retired"], propertyKey: { kind: "absent" }, search: { kind: "absent" },
          page: { limit: CatalogPageLimit(200), after } });
        if (page.status !== "found") throw new Error("proposal pinned definition inventory unavailable");
        const definition = page.page.items.find((item) => item.selectedRevision.id === revisionId);
        if (definition) return { id: revisionId, definitionId: definition.id };
        after = page.page.next;
      } while (after.kind !== "absent");
      return null;
    },
    async successAudit(organizationId: string, action: string, fingerprint: string, targetId: string) {
      return (await reader.query<{ metadata: { resultSnapshot?: unknown } | null }>(
        "select parameter_catalog.read_proposal_success_audit($1,$2,$3,$4) as metadata",
        [organizationId, action, fingerprint, targetId],
      )).rows[0]?.metadata ?? null;
    },
  };
}
export type ProposalCatalogReadPorts = ReturnType<typeof createProposalCatalogReadPorts>;
