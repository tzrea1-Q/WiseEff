import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  parseCanonicalCompatibleSelector,
  parseCanonicalNodeName,
} from "../../parameter-catalog-contract/index";
import {
  CatalogSubjectId,
  DriverCompatible,
  NormalizedNodeTypeName,
  createCatalogKernel,
  type MatchResult,
  type SubjectSelector,
} from "../interface";
import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../../testing/parameterCatalog";
import {
  CHARGER_NODE_TYPE,
  CHARGER_NODE_TYPE_ALIAS,
  CHARGER_SUBJECT_ID,
  POWER_ALIAS_ID,
  POWER_DRIVER_ALIAS,
  POWER_DRIVER_COMPATIBLE,
  SENSOR_DRIVER_COMPATIBLE,
  SENSOR_SUBJECT_ID,
  SUBJECT_ID,
  installPublishedCatalogMatchChain,
} from "./catalogChain.fixture";

const unwrap = <T>(
  result: { ok: true; value: T } | { ok: false; error: { kind: string } },
  label: string,
): T => {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error.kind}`);
  }
  return result.value;
};

const selector = (input: {
  readonly drivers?: readonly string[];
  readonly nodeType?: string;
}): SubjectSelector => ({
  driverCompatibles: (input.drivers ?? []).map(DriverCompatible),
  nodeTypeFallback:
    input.nodeType === undefined
      ? { kind: "absent" }
      : { kind: "present", name: NormalizedNodeTypeName(input.nodeType) },
});

const matchedIds = (result: MatchResult): readonly string[] => {
  if (result.status === "matched" || result.status === "retired") {
    return [result.subject.id];
  }
  if (result.status === "ambiguous") {
    return result.candidates.map((candidate) => candidate.id);
  }
  return [];
};

describe("catalog subject matching lifecycle", () => {
  let database: ParameterCatalogDatabase;
  let pool: pg.Pool;
  let kernel: ReturnType<typeof createCatalogKernel>;
  let chain: Awaited<ReturnType<typeof installPublishedCatalogMatchChain>>;

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("match03");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    kernel = createCatalogKernel(pool);
    chain = await installPublishedCatalogMatchChain(pool);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await database?.close();
  });

  const loadPinned = async (pin: (typeof chain)["pinD"], label: string) =>
    unwrap(await kernel.loadPinnedCatalog(pin), label);

  it("CATFIX-MATCH-01 active Driver canonical is a unique match", async () => {
    const snapshot = await loadPinned(chain.pinD, "pinned D");
    const result = snapshot.resolveSubject(selector({ drivers: [POWER_DRIVER_COMPATIBLE] }));
    expect(result).toMatchObject({
      status: "matched",
      matchedBy: "canonical-selector",
      alias: null,
    });
    if (result.status !== "matched") return;
    expect(result.subject.id).toBe(SUBJECT_ID);
    expect(result.subject.kind).toBe("driver");
  });

  it("CATFIX-MATCH-02 active Driver alias is matched and attributed to the alias", async () => {
    const snapshot = await loadPinned(chain.pinD, "pinned D");
    const result = snapshot.resolveSubject(selector({ drivers: [POWER_DRIVER_ALIAS] }));
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    expect(result.matchedBy).toBe("alias");
    expect(result.subject.id).toBe(SUBJECT_ID);
    expect(result.alias?.id).toBe(POWER_ALIAS_ID);
    expect(result.alias?.selector).toEqual({
      kind: "driver-compatible",
      value: POWER_DRIVER_ALIAS,
    });
    expect(result.alias?.membership.lifecycle).toBe("active");
  });

  it("CATFIX-MATCH-03 retired alias keeps retired evidence and does not NodeType-fallback", async () => {
    const snapshot = await loadPinned(chain.pinE, "pinned E");
    const result = snapshot.resolveSubject(
      selector({
        drivers: [POWER_DRIVER_ALIAS],
        nodeType: CHARGER_NODE_TYPE,
      }),
    );
    expect(result.status).toBe("retired");
    if (result.status !== "retired") return;
    expect(result.subject.id).toBe(SUBJECT_ID);
    expect(result.subject.membership.lifecycle).toBe("active");
    expect(result.alias?.id).toBe(POWER_ALIAS_ID);
    expect(result.alias?.membership.lifecycle).toBe("retired");
  });

  it("CATFIX-MATCH-04 retired Subject is not newly identified and remains readable", async () => {
    const current = unwrap(await kernel.loadCurrentCatalog(chain.pinF), "current F");
    const historical = await loadPinned(chain.pinD, "pinned D");
    const identified = current.resolveSubject(selector({ drivers: [POWER_DRIVER_COMPATIBLE] }));
    expect(identified.status).toBe("retired");
    if (identified.status === "retired") {
      expect(identified.subject.id).toBe(SUBJECT_ID);
      expect(identified.subject.membership.lifecycle).toBe("retired");
    }
    const currentLookup = current.getSubject(CatalogSubjectId(SUBJECT_ID));
    expect(currentLookup.status).toBe("retired");
    if (currentLookup.status === "retired") {
      expect(currentLookup.subject.id).toBe(SUBJECT_ID);
    }
    const historicalLookup = historical.getSubject(CatalogSubjectId(SUBJECT_ID));
    expect(historicalLookup.status).toBe("found");
  });

  it("CATFIX-MATCH-05 active NodeType alias hits the NodeType Subject", async () => {
    const snapshot = await loadPinned(chain.pinD, "pinned D");
    const result = snapshot.resolveSubject(selector({ nodeType: CHARGER_NODE_TYPE_ALIAS }));
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    expect(result.subject.id).toBe(CHARGER_SUBJECT_ID);
    expect(result.subject.kind).toBe("node-type");
    expect(result.matchedBy).toBe("alias");
    expect(result.alias?.selector).toEqual({
      kind: "node-type-name",
      value: CHARGER_NODE_TYPE_ALIAS,
    });
    const canonical = snapshot.resolveSubject(selector({ nodeType: CHARGER_NODE_TYPE }));
    expect(canonical).toMatchObject({
      status: "matched",
      matchedBy: "canonical-selector",
      alias: null,
    });
  });

  it("CATFIX-MATCH-06 canonical and alias of the same Subject dedupe with determined attribution", async () => {
    const snapshot = await loadPinned(chain.pinD, "pinned D");
    const result = snapshot.resolveSubject(
      selector({ drivers: [POWER_DRIVER_COMPATIBLE, POWER_DRIVER_ALIAS] }),
    );
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    expect(result.subject.id).toBe(SUBJECT_ID);
    expect(result.matchedBy).toBe("canonical-selector");
    expect(result.alias).toBeNull();
    expect(matchedIds(result)).toEqual([SUBJECT_ID]);
  });

  it("CATFIX-MATCH-07 distinct Driver hits stay ambiguous, including mixed live and retired evidence", async () => {
    const live = await loadPinned(chain.pinD, "pinned D");
    const twoLive = live.resolveSubject(
      selector({ drivers: [POWER_DRIVER_COMPATIBLE, SENSOR_DRIVER_COMPATIBLE] }),
    );
    expect(twoLive.status).toBe("ambiguous");
    if (twoLive.status === "ambiguous") {
      expect([...twoLive.candidates.map((candidate) => candidate.id)].sort()).toEqual(
        [SUBJECT_ID, SENSOR_SUBJECT_ID].sort(),
      );
    }

    const mixed = await loadPinned(chain.pinE, "pinned E");
    const mixedResult = mixed.resolveSubject(
      selector({
        drivers: [POWER_DRIVER_ALIAS, SENSOR_DRIVER_COMPATIBLE],
        nodeType: CHARGER_NODE_TYPE,
      }),
    );
    expect(mixedResult.status).toBe("ambiguous");
    if (mixedResult.status === "ambiguous") {
      expect([...mixedResult.candidates.map((candidate) => candidate.id)].sort()).toEqual(
        [SUBJECT_ID, SENSOR_SUBJECT_ID].sort(),
      );
    }
  });

  it("CATFIX-MATCH-08 pinned historical membership stays live after current retirement", async () => {
    const current = unwrap(await kernel.loadCurrentCatalog(chain.pinF), "current F");
    const pinned = await loadPinned(chain.pinD, "pinned D");
    const input = selector({ drivers: [POWER_DRIVER_COMPATIBLE] });
    expect(current.resolveSubject(input).status).toBe("retired");
    const historical = pinned.resolveSubject(input);
    expect(historical.status).toBe("matched");
    if (historical.status === "matched") {
      expect(historical.subject.membership.lifecycle).toBe("active");
      expect(historical.subject.membership.release.id).toBe(chain.pinD.id);
    }
    const pinnedAlias = pinned.resolveSubject(selector({ drivers: [POWER_DRIVER_ALIAS] }));
    expect(pinnedAlias.status).toBe("matched");
    const currentAlias = current.resolveSubject(selector({ drivers: [POWER_DRIVER_ALIAS] }));
    expect(currentAlias.status).toBe("retired");
  });

  it("CATFIX-MATCH-09 case, whitespace, and illegal selectors follow shared constructors", async () => {
    const snapshot = await loadPinned(chain.pinD, "pinned D");
    expect(parseCanonicalCompatibleSelector(" ACME,POWER ").ok).toBe(false);
    expect(parseCanonicalCompatibleSelector("acme,power ").ok).toBe(false);
    expect(parseCanonicalCompatibleSelector("acme,*").ok).toBe(false);
    expect(parseCanonicalNodeName("charger@1").ok).toBe(false);
    expect(parseCanonicalNodeName(" charger").ok).toBe(false);
    expect(parseCanonicalCompatibleSelector("ACME,POWER")).toEqual({
      ok: true,
      value: "ACME,POWER",
    });

    expect(
      snapshot.resolveSubject(selector({ drivers: ["ACME,POWER"] })).status,
    ).toBe("unknown");
    expect(
      snapshot.resolveSubject(selector({ drivers: [" acme,power"] })).status,
    ).toBe("unknown");
    expect(
      snapshot.resolveSubject(selector({ drivers: ["acme,power "] })).status,
    ).toBe("unknown");
    expect(
      snapshot.resolveSubject(selector({ drivers: ["acme,*"] })).status,
    ).toBe("unknown");
    expect(snapshot.resolveSubject(selector({ nodeType: "charger@1" })).status).toBe(
      "unknown",
    );
    expect(
      snapshot.resolveSubject(selector({ drivers: ["acme,*"], nodeType: CHARGER_NODE_TYPE }))
        .status,
    ).toBe("matched");
    expect(
      snapshot.resolveSubject(
        selector({ drivers: [POWER_DRIVER_COMPATIBLE, "ACME,POWER", " acme,power"] }),
      ).status,
    ).toBe("matched");
  });

  it("CATFIX-MATCH-10 unknown and ambiguous matching stay read-only", async () => {
    const inventory = async () => {
      const counted = await pool.query<{
        subjects: number;
        aliases: number;
        definitions: number;
        observations: number;
        bindings: number;
        current_release: string;
      }>(
        `select
           (select count(*)::int from parameter_catalog.catalog_subjects) as subjects,
           (select count(*)::int from parameter_catalog.catalog_subject_aliases) as aliases,
           (select count(*)::int from parameter_catalog.parameter_definitions) as definitions,
           (select count(*)::int from parameter_catalog.parameter_observations) as observations,
           (select count(*)::int from public.project_parameter_bindings) as bindings,
           (select current_catalog_release_id from parameter_catalog.catalog_state) as current_release`,
      );
      return counted.rows[0]!;
    };
    const before = await inventory();
    const current = unwrap(await kernel.loadCurrentCatalog(chain.pinF), "current F");
    const unknown = current.resolveSubject(selector({ drivers: ["missing,device"] }));
    const ambiguous = unwrap(await kernel.loadPinnedCatalog(chain.pinD), "pinned D").resolveSubject(
      selector({ drivers: [POWER_DRIVER_COMPATIBLE, SENSOR_DRIVER_COMPATIBLE] }),
    );
    expect(unknown).toEqual({ status: "unknown", reason: "no-candidate" });
    expect(ambiguous.status).toBe("ambiguous");
    const after = await inventory();
    expect(after).toEqual(before);
    expect(after.current_release).toBe(chain.pinF.id);
  });
});
