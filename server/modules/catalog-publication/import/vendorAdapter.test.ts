import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { firstAcmePredecessor } from "../builder/predecessorHarness";
import {
  allocateOpaqueId,
  importVendorCatalog,
  type VendorIdKind,
} from "./vendorAdapter";
import {
  EXCLUDED_SCHEMA_BASENAMES,
  POWER_MANAGEMENT_BASENAME,
  inventoryVendorCatalog,
  vendorDirectoryHash,
} from "./vendorYaml";

const chargerYaml = `$id: wiseeff/test-charger.yaml
title: acme,test-charger
source: vendor
lifecycle: active
version: 1
schemaNamespace: vendor/acme,test-charger
compatible:
  - acme,test-charger
properties:
  iin_limit:
    valueShape: integer
    units: mA
    constraints: {}
    documentation: Vendor input current limit.
`;

const boardYaml = `$id: wiseeff/test-board.yaml
title: test-board
source: vendor
lifecycle: active
version: 1
schemaNamespace: vendor/nodename/test-board
nodename:
  - test-board
properties:
  board_rev:
    valueShape: string
    documentation: Board revision string.
`;

const writeTree = (
  files: Record<string, string>,
  schemaPaths: string[],
  extras: Record<string, string> = {},
): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wiseeff-vendor-import-"));
  const schemasRoot = path.join(root, "schemas/dts");
  const vendorDir = path.join(schemasRoot, "vendor/wiseeff");
  mkdirSync(vendorDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(vendorDir, name), body);
  }
  for (const [name, body] of Object.entries(extras)) {
    writeFileSync(path.join(vendorDir, name), body);
  }
  writeFileSync(
    path.join(schemasRoot, "catalog.json"),
    JSON.stringify({
      vendorContentHash: vendorDirectoryHash(vendorDir),
      schemaPaths,
      importedAt: "2026-09-13T00:00:00.000Z",
    }),
  );
  return schemasRoot;
};

const sequentialIds = (label: string) => {
  const counts: Partial<Record<VendorIdKind, number>> = {};
  return (kind: VendorIdKind): string => {
    counts[kind] = (counts[kind] ?? 0) + 1;
    return `${kind}_${label}_${counts[kind]}`;
  };
};

const identity = (label: string, releaseVersion = "1.2.0") => ({
  publishedAt: "2026-09-13T12:00:00Z",
  releaseVersion,
  candidateId: `ccand_${label}`,
  artifactId: `cart_${label}`,
  releaseId: `crel_${label}`,
  allocateId: sequentialIds(label),
});

const AUTHOR_PRINCIPAL = "user-catalog-author";

const importOpts = (label: string, releaseVersion?: string) => ({
  identity: identity(label, releaseVersion),
  authorPrincipalId: AUTHOR_PRINCIPAL,
});

describe("inventoryVendorCatalog", () => {
  it("selects catalog.json schemaPaths rather than walking the vendor directory", () => {
    const repoSchemas = path.join(process.cwd(), "schemas/dts");
    const inventory = inventoryVendorCatalog(repoSchemas);
    expect(inventory.ok).toBe(true);
    if (!inventory.ok) return;
    const catalog = JSON.parse(readFileSync(path.join(repoSchemas, "catalog.json"), "utf8")) as {
      schemaPaths: string[];
      vendorContentHash: string;
    };
    expect(inventory.value.schemaPaths).toEqual(catalog.schemaPaths);
    expect(inventory.value.vendorContentHash).toBe(catalog.vendorContentHash);
    expect(inventory.value.observedDirectoryHash).toBe(catalog.vendorContentHash);
    expect(inventory.value.files.filter((file) => file.disposition === "input").map((file) => file.relativePath)).toEqual(
      catalog.schemaPaths.filter((relativePath) => !EXCLUDED_SCHEMA_BASENAMES.includes(path.basename(relativePath) as (typeof EXCLUDED_SCHEMA_BASENAMES)[number])),
    );
    const extra = inventory.value.files.filter((file) => !file.listed);
    expect(extra.map((file) => file.basename)).toEqual(["common-status.yaml"]);
    expect(extra[0]?.disposition).toBe("extra-not-imported");
    const excludedListed = inventory.value.files.filter((file) => file.listed && file.excluded);
    expect(excludedListed.map((file) => file.basename).sort()).toEqual([
      "test-ambiguous-a.yaml",
      "test-ambiguous-b.yaml",
    ]);
    expect(inventory.value.files.some((file) => file.basename === POWER_MANAGEMENT_BASENAME)).toBe(false);
    expect(existsSync(path.join(process.cwd(), "src/config", POWER_MANAGEMENT_BASENAME))).toBe(true);
    expect(inventory.value.schemaPaths).not.toContain("src/config/power-management.json");
  });

  it("refuses a forged extra file that is not listed in schemaPaths", () => {
    const schemasRoot = writeTree(
      { "only.yaml": chargerYaml },
      ["vendor/wiseeff/only.yaml"],
      { "forged.yaml": "title: forged\n" },
    );
    const inventory = inventoryVendorCatalog(schemasRoot);
    expect(inventory.ok).toBe(false);
    if (inventory.ok) return;
    expect(inventory.error.kind).toBe("extra-file-forbidden");
  });

  it("refuses a listed path that is missing on disk even when the directory hash is restated", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wiseeff-vendor-missing-"));
    const schemasRoot = path.join(root, "schemas/dts");
    const vendorDir = path.join(schemasRoot, "vendor/wiseeff");
    mkdirSync(vendorDir, { recursive: true });
    writeFileSync(path.join(vendorDir, "present.yaml"), chargerYaml);
    writeFileSync(
      path.join(schemasRoot, "catalog.json"),
      JSON.stringify({
        vendorContentHash: vendorDirectoryHash(vendorDir),
        schemaPaths: ["vendor/wiseeff/present.yaml", "vendor/wiseeff/missing.yaml"],
      }),
    );
    const inventory = inventoryVendorCatalog(schemasRoot);
    expect(inventory.ok).toBe(false);
    if (inventory.ok) return;
    expect(inventory.error).toEqual({
      kind: "listed-file-missing",
      relativePath: "vendor/wiseeff/missing.yaml",
    });
  });

  it("refuses a vendorContentHash that does not match on-disk YAML", () => {
    const schemasRoot = writeTree({ "only.yaml": chargerYaml }, ["vendor/wiseeff/only.yaml"]);
    writeFileSync(
      path.join(schemasRoot, "catalog.json"),
      JSON.stringify({
        vendorContentHash: "0".repeat(64),
        schemaPaths: ["vendor/wiseeff/only.yaml"],
      }),
    );
    const inventory = inventoryVendorCatalog(schemasRoot);
    expect(inventory.ok).toBe(false);
    if (inventory.ok) return;
    expect(inventory.error.kind).toBe("catalog-vendor-hash-mismatch");
  });
});

describe("importVendorCatalog", () => {
  it("emits typed subject changes with opaque IDs and keeps acme predecessor identities", async () => {
    const predecessor = firstAcmePredecessor();
    const schemasRoot = writeTree(
      { "charger.yaml": chargerYaml, "board.yaml": boardYaml },
      ["vendor/wiseeff/charger.yaml", "vendor/wiseeff/board.yaml"],
    );
    const result = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      schemasRoot,
      ...importOpts("opaque"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "successor") return;
    expect(result.value.changeSet.map((change) => change.op).sort()).toEqual([
      "create-subject-with-definitions",
      "create-subject-with-definitions",
    ]);
    const driverChange = result.value.changeSet.find(
      (change) => change.op === "create-subject-with-definitions" && change.kind === "driver",
    );
    const nodeChange = result.value.changeSet.find(
      (change) => change.op === "create-subject-with-definitions" && change.kind === "node-type",
    );
    expect(driverChange).toMatchObject({
      op: "create-subject-with-definitions",
      kind: "driver",
      nature: "physical-device",
      cardinality: "multiple",
    });
    expect(nodeChange).toMatchObject({
      op: "create-subject-with-definitions",
      kind: "node-type",
    });
    expect(nodeChange && "nature" in nodeChange).toBe(false);
    expect(nodeChange && "cardinality" in nodeChange).toBe(false);
    expect(nodeChange && "family" in nodeChange).toBe(false);
    expect(result.value.report.appliedDefaults).toEqual([
      {
        canonicalKey: "driver:acme,test-charger",
        nature: "physical-device",
        cardinality: "multiple",
        reason: "new-driver-compiler-default",
      },
    ]);
    expect(
      result.value.report.dispositions.some(
        (row) =>
          row.path === "vendor/wiseeff/charger.yaml" &&
          row.kind === "mapped" &&
          row.detail === "applied-driver-defaults:nature=physical-device,cardinality=multiple",
      ),
    ).toBe(true);
    expect(result.value.frozenIdentity.subjects?.map((entry) => entry.subjectId).sort()).toEqual([
      "csub_opaque_1",
      "csub_opaque_2",
    ]);
    expect(result.value.frozenIdentity.subjects?.some((entry) => entry.subjectId.includes("test_charger"))).toBe(
      false,
    );
    expect(result.value.impactFacts.sourceKind).toBe("vendor-yaml");
    expect(result.value.impactFacts.introducesNewSubject).toBe(true);
    const classifiedHigh = result.value.impactFacts.introducesNewSubject;
    expect(classifiedHigh).toBe(true);

    const built = result.value.built;
    expect(built.kind).toBe("successor");
    if (built.kind !== "successor") return;
    const target = built.artifact.bundle.releases.find(
      (release) => release.manifest.release.id === built.artifact.targetReleaseId,
    );
    expect(target).toBeDefined();
    if (!target) return;
    expect(target.documents.some((document) => document.content.id === "csub_acme_power")).toBe(true);
    expect(target.documents.some((document) => document.content.id === "pdef_acme_power_iin_max")).toBe(true);
    expect(target.documents.some((document) => document.content.id === "cali_acme_power_v1")).toBe(true);
    const charger = target.documents.find(
      (document) => document.kind === "subject" && document.content.canonicalKey === "driver:acme,test-charger",
    );
    expect(charger?.kind).toBe("subject");
    if (charger?.kind !== "subject") return;
    expect(charger.content.id).toBe("csub_opaque_1");
    expect(charger.content.id.startsWith("csub_drv_")).toBe(false);
    expect(charger.content.subtype).toEqual({
      nature: "physical-device",
      cardinality: { kind: "multiple" },
    });
    const board = target.documents.find(
      (document) => document.kind === "subject" && document.content.canonicalKey === "node-type:test-board",
    );
    expect(board?.kind).toBe("subject");
    if (board?.kind === "subject") {
      expect(board.content.subtype).toEqual({});
      expect("nature" in board.content.subtype).toBe(false);
    }

    const propertyPaths = result.value.report.dispositions.filter((row) => row.path.includes("#"));
    expect(propertyPaths.some((row) => row.path.endsWith("#iin_limit") && row.kind === "mapped")).toBe(true);
    expect(propertyPaths.some((row) => row.path.endsWith("#board_rev") && row.kind === "mapped")).toBe(true);
    expect(result.value.report.dispositions.some((row) => row.path.endsWith(".exampleValue"))).toBe(false);
    const compiled = compileCatalogRelease(built.artifact.bundle);
    expect(compiled.ok).toBe(true);
  });

  it("reuses published opaque IDs and does not emit a successor when vendor YAML is unchanged", async () => {
    const predecessor = firstAcmePredecessor();
    const schemasRoot = writeTree({ "charger.yaml": chargerYaml }, ["vendor/wiseeff/charger.yaml"]);
    const first = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      schemasRoot,
      ...importOpts("first"),
    });
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.kind !== "successor" || first.value.built.kind !== "successor") return;
    const successorBytes = first.value.built.artifact.artifactBytes;
    const successorDigest = first.value.built.artifact.artifactDigest;
    const publishedSubject = first.value.frozenIdentity.subjects?.[0]?.subjectId;
    expect(publishedSubject).toBe("csub_first_1");

    const second = await importVendorCatalog({
      predecessorArtifact: { digest: successorDigest, bytes: successorBytes },
      schemasRoot,
      ...importOpts("second"),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.kind).toBe("unchanged");
    if (second.value.kind !== "unchanged") return;
    expect(second.value.changeSet).toEqual([]);
    expect(second.value.report.identityMap.some((entry) => entry.action === "allocate")).toBe(false);
    expect(
      second.value.report.identityMap.some(
        (entry) => entry.action === "reuse" && entry.publishedId === publishedSubject,
      ),
    ).toBe(true);
  });

  it("adds a definition on an existing subject without reallocating that subject", async () => {
    const predecessor = firstAcmePredecessor();
    const acmeVendor = `$id: wiseeff/acme-power.yaml
title: acme,power
source: vendor
lifecycle: active
version: 1
schemaNamespace: vendor/acme,power
compatible:
  - acme,power
properties:
  iin_min:
    valueShape: integer
    units: mA
    constraints: {}
    documentation: Vendor minimum input current.
`;
    const schemasRoot = writeTree({ "acme-power.yaml": acmeVendor }, ["vendor/wiseeff/acme-power.yaml"]);
    const result = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      schemasRoot,
      ...importOpts("acmeadd"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "successor") return;
    expect(result.value.changeSet).toEqual([
      expect.objectContaining({
        op: "create-definition",
        subjectId: "csub_acme_power",
        propertyKey: "iin_min",
      }),
    ]);
    expect(result.value.frozenIdentity.subjects ?? []).toEqual([]);
    expect(result.value.report.appliedDefaults).toEqual([]);
    expect(result.value.report.identityMap.find((entry) => entry.canonicalKey === "driver:acme,power")?.action).toBe(
      "reuse",
    );
    expect(result.value.changeSet.some((change) => "nature" in change || "cardinality" in change)).toBe(false);
  });

  it("refuses a claimed subject ID that disagrees with the published natural key", async () => {
    const predecessor = firstAcmePredecessor();
    const acmeVendor = `$id: wiseeff/acme-power.yaml
title: acme,power
source: vendor
lifecycle: active
version: 1
schemaNamespace: vendor/acme,power
compatible:
  - acme,power
properties:
  iin_peak:
    valueShape: integer
    units: mA
    constraints: {}
    documentation: Peak current.
`;
    const schemasRoot = writeTree({ "acme-power.yaml": acmeVendor }, ["vendor/wiseeff/acme-power.yaml"]);
    const result = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      schemasRoot,
      ...importOpts("claim"),
      claimedIdentities: [{ canonicalKey: "driver:acme,power", subjectId: "csub_forged_other" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("import-blocked");
    if (result.error.kind !== "import-blocked") return;
    expect(result.error.report.blocking.some((row) => row.detail === "natural-key-id-mismatch")).toBe(true);
    expect(result.error.report.identityMap.some((entry) => entry.action === "conflict")).toBe(true);
  });

  it("refuses alias owner change instead of overlaying the published alias", async () => {
    const predecessor = firstAcmePredecessor();
    const aliasOwner = `$id: wiseeff/alias-owner.yaml
title: stolen
source: vendor
lifecycle: active
version: 1
schemaNamespace: vendor/stolen
compatible:
  - acme,power-v1
properties:
  stolen_prop:
    valueShape: integer
    units: mA
    constraints: {}
    documentation: Must not steal the acme alias.
`;
    const schemasRoot = writeTree({ "alias-owner.yaml": aliasOwner }, ["vendor/wiseeff/alias-owner.yaml"]);
    const result = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      schemasRoot,
      ...importOpts("alias"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("import-blocked");
    if (result.error.kind !== "import-blocked") return;
    expect(result.error.report.blocking.some((row) => row.detail === "alias-owner-change")).toBe(true);
  });

  it("revises documentation without allocating a new definition identity", async () => {
    const predecessor = firstAcmePredecessor();
    const schemasRoot = writeTree({ "charger.yaml": chargerYaml }, ["vendor/wiseeff/charger.yaml"]);
    const first = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      schemasRoot,
      ...importOpts("doc1"),
    });
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.kind !== "successor" || first.value.built.kind !== "successor") return;
    writeFileSync(
      path.join(schemasRoot, "vendor/wiseeff/charger.yaml"),
      chargerYaml.replace("Vendor input current limit.", "Updated vendor input current limit."),
    );
    writeFileSync(
      path.join(schemasRoot, "catalog.json"),
      JSON.stringify({
        vendorContentHash: vendorDirectoryHash(path.join(schemasRoot, "vendor/wiseeff")),
        schemaPaths: ["vendor/wiseeff/charger.yaml"],
      }),
    );
    const second = await importVendorCatalog({
      predecessorArtifact: {
        digest: first.value.built.artifact.artifactDigest,
        bytes: first.value.built.artifact.artifactBytes,
      },
      schemasRoot,
      ...importOpts("doc2", "1.3.0"),
    });
    expect(second.ok).toBe(true);
    if (!second.ok || second.value.kind !== "successor") return;
    expect(second.value.changeSet).toEqual([
      expect.objectContaining({
        op: "revise-definition",
        class: "documentation",
        definitionId: first.value.frozenIdentity.definitions[0]?.definitionId,
      }),
    ]);
    if (second.value.built.kind !== "successor") return;
    expect(second.value.built.impact.definitions.changed).toHaveLength(1);
    expect(second.value.built.impact.definitions.added).toEqual([]);
    expect(second.value.impactFacts.changesUnitOrSemantic).toBe(false);
  });

  it("treats a semantic vendor revision as high-risk and does not last-wins overwrite silently", async () => {
    const predecessor = firstAcmePredecessor();
    const schemasRoot = writeTree({ "charger.yaml": chargerYaml }, ["vendor/wiseeff/charger.yaml"]);
    const first = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      schemasRoot,
      ...importOpts("sem1"),
    });
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.kind !== "successor" || first.value.built.kind !== "successor") return;
    writeFileSync(
      path.join(schemasRoot, "vendor/wiseeff/charger.yaml"),
      chargerYaml.replace("constraints: {}", "constraints:\n      minimum: 1"),
    );
    writeFileSync(
      path.join(schemasRoot, "catalog.json"),
      JSON.stringify({
        vendorContentHash: vendorDirectoryHash(path.join(schemasRoot, "vendor/wiseeff")),
        schemaPaths: ["vendor/wiseeff/charger.yaml"],
      }),
    );
    const second = await importVendorCatalog({
      predecessorArtifact: {
        digest: first.value.built.artifact.artifactDigest,
        bytes: first.value.built.artifact.artifactBytes,
      },
      schemasRoot,
      ...importOpts("sem2", "1.3.0"),
    });
    expect(second.ok).toBe(true);
    if (!second.ok || second.value.kind !== "successor") return;
    expect(second.value.changeSet).toEqual([
      expect.objectContaining({ op: "revise-definition", class: "semantic" }),
    ]);
    expect(second.value.impactFacts.changesUnitOrSemantic).toBe(true);
  });

  it("accounts every listed source property of the repository catalog and refuses unsupported shapes", async () => {
    const predecessor = firstAcmePredecessor();
    const result = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      schemasRoot: path.join(process.cwd(), "schemas/dts"),
      ...importOpts("repo"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("import-blocked");
    if (result.error.kind !== "import-blocked") return;
    const propertyRows = result.error.report.dispositions.filter((row) => {
      const fragment = row.path.split("#")[1];
      return fragment !== undefined && !fragment.includes(".");
    });
    const catalog = JSON.parse(
      readFileSync(path.join(process.cwd(), "schemas/dts/catalog.json"), "utf8"),
    ) as { schemaPaths: string[] };
    const inputFiles = catalog.schemaPaths.filter(
      (relativePath) => !EXCLUDED_SCHEMA_BASENAMES.includes(path.basename(relativePath) as (typeof EXCLUDED_SCHEMA_BASENAMES)[number]),
    );
    expect(propertyRows.length).toBeGreaterThan(0);
    for (const relativePath of inputFiles) {
      expect(result.error.report.dispositions.some((row) => row.path.startsWith(relativePath))).toBe(true);
    }
    expect(result.error.report.blocking.some((row) => row.kind === "unsupported")).toBe(true);
    expect(result.error.report.dispositions.some((row) => row.path.includes("childNodes"))).toBe(true);
  });

  it("refuses unhandled constraints and does not repair input from the predecessor", async () => {
    const predecessor = firstAcmePredecessor();
    const constrained = chargerYaml.replace(
      "constraints: {}",
      "constraints:\n      cells: 3",
    );
    const schemasRoot = writeTree({ "charger.yaml": constrained }, ["vendor/wiseeff/charger.yaml"]);
    const result = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      schemasRoot,
      ...importOpts("cons"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("import-blocked");
    if (result.error.kind !== "import-blocked") return;
    expect(result.error.report.blocking.some((row) => row.detail.startsWith("unhandled-constraint"))).toBe(true);
  });

  it("reconciles each supported source property to a named successor definition", async () => {
    const predecessor = firstAcmePredecessor();
    const charger = `$id: wiseeff/test-charger.yaml
title: acme,test-charger
source: vendor
lifecycle: active
version: 1
schemaNamespace: vendor/acme,test-charger
compatible:
  - acme,test-charger
properties:
  iin_limit:
    valueShape: integer
    units: mA
    constraints: {}
    exampleValue: 1200
    documentation: Vendor input current limit.
  status:
    valueShape: integer
    documentation: Node enablement is not a parameter.
`;
    const board = boardYaml;
    const ambiguous = `$id: wiseeff/test-ambiguous-a.yaml
title: Ambiguous fixture A
source: vendor
lifecycle: active
version: 1
schemaNamespace: vendor/test-ambiguous-a
compatible:
  - wiseeff,test-ambiguous
properties:
  shared_prop:
    valueShape: integer
    documentation: Excluded fixture property.
`;
    const schemasRoot = writeTree(
      {
        "charger.yaml": charger,
        "board.yaml": board,
        "test-ambiguous-a.yaml": ambiguous,
      },
      [
        "vendor/wiseeff/charger.yaml",
        "vendor/wiseeff/board.yaml",
        "vendor/wiseeff/test-ambiguous-a.yaml",
      ],
    );
    const result = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      schemasRoot,
      ...importOpts("acct"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "successor" || result.value.built.kind !== "successor") return;

    const propertyKind = (propertyPath: string) => {
      const row = result.value.report.dispositions.find((entry) => entry.path === propertyPath);
      expect(row, propertyPath).toBeDefined();
      return row!.kind;
    };
    expect(propertyKind("vendor/wiseeff/charger.yaml#iin_limit")).toBe("mapped");
    expect(propertyKind("vendor/wiseeff/charger.yaml#status")).toBe("structural-non-param");
    expect(propertyKind("vendor/wiseeff/board.yaml#board_rev")).toBe("mapped");
    expect(propertyKind("vendor/wiseeff/test-ambiguous-a.yaml#shared_prop")).toBe("excluded");
    expect(
      result.value.report.dispositions.find((row) => row.path === "vendor/wiseeff/charger.yaml#iin_limit.exampleValue")
        ?.kind,
    ).toBe("structural-non-param");
    expect(
      result.value.report.dispositions.find((row) => row.path === "vendor/wiseeff/charger.yaml#iin_limit.constraints")
        ?.kind,
    ).toBe("structural-non-param");

    const listedProperties = [
      "vendor/wiseeff/charger.yaml#iin_limit",
      "vendor/wiseeff/charger.yaml#status",
      "vendor/wiseeff/board.yaml#board_rev",
      "vendor/wiseeff/test-ambiguous-a.yaml#shared_prop",
    ];
    for (const propertyPath of listedProperties) {
      expect(["mapped", "structural-non-param", "excluded", "unsupported", "conflict"]).toContain(
        propertyKind(propertyPath),
      );
    }

    const target = result.value.built.artifact.bundle.releases.find(
      (release) => release.manifest.release.id === result.value.built.artifact.targetReleaseId,
    );
    expect(target).toBeDefined();
    if (!target) return;
    const mapped = result.value.report.dispositions.filter((row) => {
      const fragment = row.path.split("#")[1];
      return row.kind === "mapped" && fragment !== undefined && !fragment.includes(".");
    });
    expect(mapped.map((row) => row.path).sort()).toEqual([
      "vendor/wiseeff/board.yaml#board_rev",
      "vendor/wiseeff/charger.yaml#iin_limit",
    ]);
    for (const row of mapped) {
      const propertyKey = row.path.split("#")[1]!;
      const allocated = result.value.report.identityMap.find(
        (entry) => entry.propertyKey === propertyKey && entry.action === "allocate",
      );
      expect(allocated, propertyKey).toBeDefined();
      const document = target.documents.find(
        (entry) => entry.kind === "definition" && entry.content.propertyKey === propertyKey,
      );
      expect(document?.kind).toBe("definition");
      if (document?.kind !== "definition") continue;
      expect(document.content.id).toBe(allocated!.publishedId);
      expect(document.content.subjectId).toBe(
        result.value.report.identityMap.find(
          (entry) => entry.canonicalKey !== undefined && entry.publishedId === document.content.subjectId,
        )?.publishedId,
      );
    }
    expect(target.documents.some((entry) => entry.kind === "definition" && entry.content.propertyKey === "status")).toBe(
      false,
    );
    expect(
      target.documents.some((entry) => entry.kind === "definition" && entry.content.propertyKey === "shared_prop"),
    ).toBe(false);
  });

  it("T18 refuses a missing predecessor Artifact without building a successor", async () => {
    const predecessor = firstAcmePredecessor();
    const schemasRoot = writeTree({ "charger.yaml": chargerYaml }, ["vendor/wiseeff/charger.yaml"]);
    const result = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest },
      schemasRoot,
      ...importOpts("t18miss"),
    });
    expect(result).toEqual({ ok: false, error: { kind: "artifact-missing" } });
  });

  it("T18 refuses unreadable predecessor bytes as predecessor-incomplete", async () => {
    const bytes = new TextEncoder().encode("{not-a-catalog-bundle");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const result = await importVendorCatalog({
      predecessorArtifact: { digest, bytes },
      schemasRoot: writeTree({ "charger.yaml": chargerYaml }, ["vendor/wiseeff/charger.yaml"]),
      ...importOpts("t18bad"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("predecessor-incomplete");
  });

  it("T18 refuses a predecessor digest mismatch", async () => {
    const predecessor = firstAcmePredecessor();
    const result = await importVendorCatalog({
      predecessorArtifact: { digest: `sha256:${"a".repeat(64)}`, bytes: predecessor.bytes },
      schemasRoot: writeTree({ "charger.yaml": chargerYaml }, ["vendor/wiseeff/charger.yaml"]),
      ...importOpts("t18mis"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("artifact-digest-mismatch");
  });

  it("refuses an omitted author principal instead of defaulting vendor-import", async () => {
    const predecessor = firstAcmePredecessor();
    const result = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      schemasRoot: writeTree({ "charger.yaml": chargerYaml }, ["vendor/wiseeff/charger.yaml"]),
      identity: identity("noauthor"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: "invalid-input",
      reason: "authorPrincipalId is required",
    });
  });

  it("does not parse opaque IDs to infer canonical identity", () => {
    const id = allocateOpaqueId("csub");
    expect(id.startsWith("csub_")).toBe(true);
    expect(id.includes("acme")).toBe(false);
    expect(id.includes("test-charger")).toBe(false);
  });
});
