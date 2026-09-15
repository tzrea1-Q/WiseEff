/**
 * Issue #849 PU-01 Slice C exit evidence: one end-to-end publish of a
 * configuration-schema release.
 *
 * Proves the third subject kind is installable, materializes the correct subtype,
 * carries the correct selector namespace through materialization, and is reachable
 * by the runtime matcher through an explicit governed model identifier only.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../compiler/index";
import {
  refreshAuthoritativeSource,
  validCatalogReleaseBundle,
} from "../compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../compiler/types";
import { jsonCatalogReleaseSource } from "../interface";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase
} from "../../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { installPublishedRelease } from "./installer";
import { CatalogSubjectId } from "../../parameter-catalog-contract/index";
import { resolveCatalogSubject } from "../runtime/subjectMatch";
import {
  NormalizedConfigurationSchemaId,
  type CatalogSubjectDetailSnapshot
} from "../interface";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "configuration-schema publish requires a reachable real PostgreSQL server; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (select 1 from pg_catalog.pg_extension where extname = 'vector') as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "configuration-schema publish requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const MODEL_ID = "wiseeff.charger.cv";
const SUBJECT_ID = "csub_wiseeff_charger_cv";

/**
 * Clone the canonical bundle's first release and swap in a configuration-schema
 * subject. Only the first release is used: it has no predecessor, so it bootstraps
 * directly, which is what "one end-to-end publish" needs.
 */
const configurationSchemaBundle = (): CatalogReleaseBundle => {
  const base = validCatalogReleaseBundle();
  const bundle = structuredClone(base) as unknown as {
    schemaVersion: string;
    releases: Array<{
      manifest: { release: { id: string } };
      documents: Array<{ kind: string; content: Record<string, unknown> }>;
    }>;
  };
  const release = bundle.releases[0]!;
  for (const document of release.documents) {
    if (document.kind === "subject") {
      document.content = {
        id: SUBJECT_ID,
        kind: "configuration-schema",
        canonicalKey: MODEL_ID,
        lifecycle: "active",
        selector: {
          kind: "configuration-schema-id",
          value: MODEL_ID,
          provenance: { source: "issue-849" }
        },
        subtype: {},
        tombstone: null
      };
    } else if (document.kind === "alias") {
      document.content = {
        ...document.content,
        id: "cali_wiseeff_charger_cv_v1",
        subjectId: SUBJECT_ID,
        selectorKind: "configuration-schema-id",
        normalizedSelector: "wiseeff.charger.cv.v1"
      };
    } else {
      const revision = document.content.revision as Record<string, unknown>;
      const matching = revision.matching as Record<string, unknown>;
      document.content = {
        ...document.content,
        subjectId: SUBJECT_ID,
        revision: {
          ...revision,
          matching: { ...matching, selectorKind: "configuration-schema-id" }
        }
      };
    }
  }
  refreshAuthoritativeSource(release as never);
  return {
    schemaVersion: bundle.schemaVersion,
    targetReleaseId: release.manifest.release.id,
    releases: [release]
  } as unknown as CatalogReleaseBundle;
};

const compileOrThrow = (bundle: CatalogReleaseBundle) => {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(
      `fixture failed to compile: ${compiled.error.kind} ${JSON.stringify(compiled.error.violations)}`,
    );
  }
  return compiled.value;
};

describe("configuration-schema release publish", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  let pool: pg.Pool;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("cfgsch");
    root = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(root)!;
  }, 60_000);

  afterAll(async () => {
    await root?.close();
    await database?.drop();
  });

  it("compiles, installs and materializes the third subject kind end to end", async () => {
    const bundle = configurationSchemaBundle();
    const compiled = compileOrThrow(bundle);
    expect(compiled.release.id.length).toBeGreaterThan(0);

    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.aggregateDigest
    });
    expect(installed.ok, JSON.stringify(installed)).toBe(true);

    const subject = await pool.query<{ kind: string; canonical_key: string }>(
      `select kind, canonical_key from parameter_catalog.catalog_subjects
        where id = $1`,
      [SUBJECT_ID]
    );
    expect(subject.rows).toEqual([{ kind: "configuration-schema", canonical_key: MODEL_ID }]);

    // Exactly one matching subtype: the new relation, and neither device relation.
    const subtypes = await pool.query<{ configuration_schema: string; drivers: string; node_types: string }>(
      `
      select
        (select count(*)::text from parameter_catalog.catalog_configuration_schemas where subject_id = $1) as configuration_schema,
        (select count(*)::text from parameter_catalog.catalog_drivers where subject_id = $1) as drivers,
        (select count(*)::text from parameter_catalog.catalog_node_types where subject_id = $1) as node_types
      `,
      [SUBJECT_ID]
    );
    expect(subtypes.rows[0]).toEqual({ configuration_schema: "1", drivers: "0", node_types: "0" });

    // The selector namespace is pinned through materialization, not defaulted.
    const membership = await pool.query<{ selector_kind: string }>(
      `select selector_snapshot ->> 'kind' as selector_kind
         from parameter_catalog.catalog_release_subjects
        where subject_id = $1`,
      [SUBJECT_ID]
    );
    expect(membership.rows.map((row) => row.selector_kind)).toEqual(["configuration-schema-id"]);

    const alias = await pool.query<{ selector_kind: string }>(
      `select selector_kind from parameter_catalog.catalog_subject_aliases
        where subject_id = $1`,
      [SUBJECT_ID]
    );
    expect(alias.rows.map((row) => row.selector_kind)).toEqual(["configuration-schema-id"]);
  }, 60_000);

  it("matches a published configuration-schema subject only by explicit model id", () => {
    const subject: CatalogSubjectDetailSnapshot = {
      id: CatalogSubjectId(SUBJECT_ID),
      kind: "configuration-schema",
      canonicalKey: MODEL_ID,
      membership: {
        release: { id: "crel_cfg", digest: "sha256:cfg" },
        lifecycle: "active",
        selector: {
          kind: "configuration-schema-id",
          value: NormalizedConfigurationSchemaId(MODEL_ID)
        },
        tombstone: { kind: "absent" }
      },
      aliases: [],
      definitionCounts: { active: 0, deprecated: 0, retired: 0 }
    } as unknown as CatalogSubjectDetailSnapshot;

    // Explicit model id resolves.
    const byModelId = resolveCatalogSubject([subject], {
      driverCompatibles: [],
      configurationSchemaIds: [NormalizedConfigurationSchemaId(MODEL_ID)],
      nodeTypeFallback: { kind: "absent" }
    });
    expect(byModelId.status).toBe("matched");

    // A driver compatible never reaches a configuration-schema subject, and the
    // node-type fallback is not consumed by one.
    const byCompatible = resolveCatalogSubject([subject], {
      driverCompatibles: [],
      nodeTypeFallback: { kind: "present", name: MODEL_ID as never }
    });
    expect(byCompatible.status).toBe("unknown");
  });
});
