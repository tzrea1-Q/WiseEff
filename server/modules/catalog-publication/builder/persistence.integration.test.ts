import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import {
  CatalogArtifactId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  DefinitionProposalId,
  DefinitionProposalRevisionId,
} from "../../parameter-catalog-contract/index";
import { createDatabase } from "../../../shared/database/client";
import {
  asQueryable,
  openEphemeralClient,
  requirePgvectorTestDatabase,
  uniqueToken,
} from "../persistence/integrationHarness";
import {
  getArtifactByDigest,
  getCandidate,
  persistArtifact,
} from "../persistence/store";
import { buildCompleteSuccessor } from "./completeSuccessor";
import {
  allocationFor,
  firstAcmePredecessor,
  frozenPageIdentity,
  pageIntegerChange,
} from "./predecessorHarness";

await requirePgvectorTestDatabase();

describe("catalog publication builder persistence", () => {
  let client: pg.Client;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const opened = await openEphemeralClient("cp03bld");
    client = opened.client;
    drop = opened.drop;
  }, 120_000);

  afterAll(async () => {
    await drop?.();
  });

  const db = () => asQueryable(client);
  const sessionDb = () => createDatabase(asQueryable(client));

  async function persistPredecessor() {
    const predecessor = firstAcmePredecessor();
    const token = uniqueToken("pred");
    const stored = await persistArtifact(db(), {
      id: CatalogArtifactId(`cart_${token}`),
      artifactDigest: predecessor.digest,
      artifactBytes: predecessor.bytes,
      sourceKind: "repository-bundle",
      targetReleaseId: CatalogReleaseId(predecessor.compiled.release.id),
      targetReleaseDigest: CatalogReleaseDigest(predecessor.digest),
      predecessorReleaseId: null,
      predecessorReleaseDigest: null,
      toolchain: { ...predecessor.first.manifest.toolchain },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error("predecessor persist failed");
    return { predecessor, stored: stored.value };
  }

  it("persists artifact then candidate in one coordinator transaction", async () => {
    const { predecessor } = await persistPredecessor();
    const frozen = frozenPageIdentity([allocationFor("iin_min")], uniqueToken("ok"));
    const result = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest },
      changeSet: [pageIntegerChange("iin_min", "Input current minimum")],
      frozenIdentity: frozen,
      persist: { db: sessionDb() },
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "successor") return;
    expect(result.value.persistence.kind).toBe("persisted");

    const artifact = await getArtifactByDigest(db(), result.value.artifact.artifactDigest);
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) return;
    const parsed = JSON.parse(new TextDecoder().decode(artifact.value.artifactBytes));
    const compiled = compileCatalogRelease(parsed);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.value.aggregateDigest).toBe(artifact.value.artifactDigest);
    }

    const candidate = await getCandidate(db(), frozen.candidateId);
    expect(candidate.ok).toBe(true);
    if (candidate.ok) {
      expect(candidate.value.artifactDigest).toBe(result.value.artifact.artifactDigest);
      expect(candidate.value.expectedBaseReleaseDigest).toBe(predecessor.digest);
      expect("riskClass" in candidate.value.capabilityContract).toBe(false);
      expect(candidate.value.identityAllocation.subjects).toEqual([]);
      expect(candidate.value.identityAllocation.impactSummary).toEqual({
        addedDefinitionCount: 1,
        changedDefinitionCount: 0,
        addedSubjectCount: 0,
      });
    }
  });

  it("rolls back the successor artifact when persistCandidate hits a real FK failure", async () => {
    const { predecessor } = await persistPredecessor();
    const beforeArtifacts = await db().query<{ count: string }>(
      "select count(*)::text as count from catalog_publication.release_artifacts",
    );
    const beforeCandidates = await db().query<{ count: string }>(
      "select count(*)::text as count from catalog_publication.candidates",
    );
    const frozen = frozenPageIdentity([allocationFor("iin_min")], uniqueToken("fk"));
    const result = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      changeSet: [pageIntegerChange("iin_min", "Input current minimum")],
      frozenIdentity: frozen,
      proposal: {
        proposalId: DefinitionProposalId("dprop_missing_cp03"),
        proposalRevisionId: DefinitionProposalRevisionId("dprev_missing_cp03"),
      },
      persist: { db: sessionDb() },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("persist-failed");
      if (result.error.kind === "persist-failed") {
        expect(result.error.stage).toBe("candidate");
      }
    }
    const afterArtifacts = await db().query<{ count: string }>(
      "select count(*)::text as count from catalog_publication.release_artifacts",
    );
    const afterCandidates = await db().query<{ count: string }>(
      "select count(*)::text as count from catalog_publication.candidates",
    );
    expect(afterArtifacts.rows[0]?.count).toBe(beforeArtifacts.rows[0]?.count);
    expect(afterCandidates.rows[0]?.count).toBe(beforeCandidates.rows[0]?.count);

    const leftoverCandidate = await getCandidate(db(), frozen.candidateId);
    expect(leftoverCandidate.ok).toBe(false);
    const leftoverArtifact = await db().query<{ count: string }>(
      "select count(*)::text as count from catalog_publication.release_artifacts where id = $1",
      [frozen.artifactId],
    );
    expect(leftoverArtifact.rows[0]?.count).toBe("0");
    const catalogRows = await db().query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.catalog_releases",
    );
    expect(catalogRows.rows[0]?.count).toBe("0");
  });

  it("does not persist when the predecessor digest is missing", async () => {
    const beforeArtifacts = await db().query<{ count: string }>(
      "select count(*)::text as count from catalog_publication.release_artifacts",
    );
    const missing = await buildCompleteSuccessor({
      predecessorArtifact: { digest: `sha256:${"b".repeat(64)}` },
      changeSet: [pageIntegerChange("iin_min", "Input current minimum")],
      frozenIdentity: frozenPageIdentity([allocationFor("iin_min")], uniqueToken("miss")),
      persist: { db: sessionDb() },
    });
    expect(missing).toEqual({ ok: false, error: { kind: "artifact-missing" } });
    const afterArtifacts = await db().query<{ count: string }>(
      "select count(*)::text as count from catalog_publication.release_artifacts",
    );
    expect(afterArtifacts.rows[0]?.count).toBe(beforeArtifacts.rows[0]?.count);
  });
});
