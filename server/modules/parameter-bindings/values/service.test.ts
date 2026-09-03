import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CatalogSubjectId,
  DefinitionRevisionId,
  ParameterBindingId,
  ParameterDefinitionId,
  ProjectValueId,
  SubjectRegistrationId,
} from "../../parameter-catalog-contract/index";
import type { Binding } from "../binding";

import {
  THREAT_MATRIX,
  appendProjectValue,
  createProjectValueService,
  mutateExistingProjectValue,
  readProjectValueHistory,
  type AppendProjectValueCommand,
} from "./index";

const dir = path.dirname(fileURLToPath(import.meta.url));

const productionFiles = readdirSync(dir).filter(
  (file) => file.endsWith(".ts") && !file.includes(".test."),
);

const catalogStructuralTokens = [
  "catalog_releases",
  "catalog_subjects",
  "catalog_drivers",
  "catalog_node_types",
  "catalog_release_subjects",
  "catalog_subject_aliases",
  "catalog_release_subject_aliases",
  "parameter_definitions",
  "definition_revisions",
  "catalog_release_definition_heads",
  "catalog_materializations",
  "catalog_state",
] as const;

const allowedCatalogIdentifiers = new Set([
  "project_parameter_bindings",
  "binding_history_events",
]);

const snapshotRelease = {
  id: "crel_acme_1",
  version: "1.0.0",
  digest: `sha256:${"a".repeat(64)}`,
} as const;

const selectedRevision = {
  id: DefinitionRevisionId("drev_acme_power_iin_max_1"),
  definitionId: ParameterDefinitionId("pdef_acme_power_iin_max"),
  revisionNumber: 1,
  contentDigest: `sha256:${"b".repeat(64)}`,
  publishedIn: snapshotRelease,
  content: {
    lifecycle: "active" as const,
    displayName: "Input current limit",
    description: { kind: "absent" as const },
    documentation: { kind: "absent" as const },
    valueShape: { kind: "json-schema" as const, schema: {} },
    constraints: { kind: "none" as const },
    unit: { kind: "absent" as const },
    schemaDefault: { kind: "absent" as const },
    examples: [],
    matching: {
      sourceProperty: "iin_max",
      selectorKind: "driver-compatible" as const,
      notes: { kind: "absent" as const },
    },
  },
};

const definition = {
  id: ParameterDefinitionId("pdef_acme_power_iin_max"),
  subjectId: CatalogSubjectId("csub_acme_power"),
  propertyKey: "iin_max",
  selectedRevision,
};

const snapshot = {
  release: snapshotRelease,
  getSubject: () => ({ status: "unknown" as const, target: "subject" as const }),
  listSubjects: () => ({ status: "invalid-page" as const, reason: "cursor-malformed" as const }),
  resolveSubject: () => ({ status: "unknown" as const, reason: "no-candidate" as const }),
  getDefinition: () => ({ status: "found" as const, definition }),
  getDefinitionById: () => ({ status: "found" as const, definition }),
  listDefinitions: () => ({ status: "invalid-page" as const, reason: "cursor-malformed" as const }),
  getDefinitionRevision: (input: {
    readonly definitionId: ParameterDefinitionId;
    readonly revisionId: DefinitionRevisionId;
  }) =>
    input.revisionId === selectedRevision.id
      ? { status: "found" as const, revision: selectedRevision }
      : {
          status: "revision-unavailable" as const,
          definitionId: input.definitionId,
          revisionId: input.revisionId,
          reason: "not-in-snapshot" as const,
        },
  listDefinitionRevisions: () => ({
    status: "unknown" as const,
    target: "definition" as const,
  }),
  listDefinitionTimelineFacts: () => ({
    status: "unknown" as const,
    target: "definition" as const,
  }),
};

const binding: Binding = {
  id: ParameterBindingId("pbind_s6_val"),
  organizationId: "org-s6-val",
  projectId: "project-s6-val",
  logicalNodeId: "logical-node-s6-val",
  registrationId: SubjectRegistrationId("sreg_s6_val"),
  subjectId: CatalogSubjectId("csub_acme_power"),
  definitionId: ParameterDefinitionId("pdef_acme_power_iin_max"),
  effectiveRevisionId: DefinitionRevisionId("drev_acme_power_iin_max_1"),
  catalogRelease: snapshotRelease,
  currentValueId: ProjectValueId("pval_placeholder"),
};

const appendCommand = (
  overrides: Partial<AppendProjectValueCommand> = {},
): AppendProjectValueCommand => ({
  snapshot,
  binding,
  definitionRevisionId: binding.effectiveRevisionId,
  source: { sourceRef: "config-set:main", configRevisionId: "crev-1" },
  payload: { kind: "number", value: 1500 },
  expectedTip: binding.currentValueId,
  ...overrides,
});

describe("S6-VAL public command contract", () => {
  it("owns the frozen threat-matrix coverage and public append/CAS/history seam", () => {
    expect(THREAT_MATRIX).toHaveLength(9);
    expect(typeof appendProjectValue).toBe("function");
    expect(typeof readProjectValueHistory).toBe("function");
    expect(typeof mutateExistingProjectValue).toBe("function");
    expect(typeof createProjectValueService).toBe("function");
  });

  it("rejects blank identity fields before any store write", async () => {
    const result = await appendProjectValue(
      { query: async () => ({ rows: [] }) } as never,
      appendCommand({
        source: { sourceRef: "  padded  ", configRevisionId: "crev-1" },
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid-command", reason: "sourceRef" },
    });
  });

  it("does not export a repository, transaction, or Catalog writer", async () => {
    const exported = await import("./index");
    expect("deriveProjectValueId" in exported).toBe(false);
    expect("casCurrentTip" in exported).toBe(false);
    expect("insertProjectValue" in exported).toBe(false);
    expect(Object.keys(exported).some((key) => /repository/i.test(key))).toBe(false);
    expect(Object.keys(exported).some((key) => /unitOfWork|UnitOfWork|transaction/i.test(key))).toBe(
      false,
    );
  });
});

describe("S6-VAL production Catalog isolation", () => {
  it("never selects or inserts Catalog structural rows and never mutates ProjectValue rows in place", () => {
    expect([...productionFiles].sort()).toEqual(
      ["index.ts", "repositories.ts", "service.ts", "threatMatrix.ts", "types.ts"].sort(),
    );

    const sources = productionFiles.map((file) => ({
      file,
      source: readFileSync(path.join(dir, file), "utf8"),
    }));
    for (const { file, source } of sources) {
      expect(source, file).not.toContain("parameter_definitions");
      expect(source, file).not.toContain("project_parameter_values");
      expect(source, file).not.toMatch(/pg_advisory_/);
      expect(source, file).not.toContain("assert_catalog_subject_active");
      expect(source, file).not.toContain("listDefinitionRevisions(");
      expect(source, file).not.toContain("stabilizeCanonicalBinding");
      expect(source, file).not.toContain("writeGuardedRegistration");
      for (const token of catalogStructuralTokens) {
        expect(source, `${file} must not mention ${token}`).not.toContain(token);
      }
      const identifiers = [...source.matchAll(/parameter_catalog\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(
        (match) => match[1],
      );
      for (const identifier of identifiers) {
        expect(allowedCatalogIdentifiers.has(identifier), `${file} -> ${identifier}`).toBe(true);
      }
      expect(source, file).not.toMatch(
        /insert into\s+parameter_catalog\.catalog_releases|select[\s\S]{0,80}from\s+parameter_catalog\.catalog_releases/i,
      );
      expect(source, file).not.toMatch(
        /(?:update|delete\s+from)\s+parameter_catalog\.\$\{\s*\[\s*["']project_parameter["']/i,
      );
    }

    const repositories = sources.find((entry) => entry.file === "repositories.ts");
    const index = sources.find((entry) => entry.file === "index.ts");
    const types = sources.find((entry) => entry.file === "types.ts");
    const service = sources.find((entry) => entry.file === "service.ts");
    expect(repositories?.source).toContain('["project_parameter", "values"].join("_")');
    expect(index?.source).not.toContain("from \"./repositories\"");
    expect(types?.source).toContain("CatalogSnapshot");
    expect(types?.source).toContain("Binding");
    expect(service?.source).toContain("expectedTip");
  });
});
