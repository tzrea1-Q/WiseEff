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
  createProtectedWorkflowAdapters,
  readProtectedReference,
  writebackProtectedReference,
  type ProtectedReadCommand,
  type ProtectedWritebackCommand,
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
  id: ParameterBindingId("pbind_s6_wfa"),
  organizationId: "org-s6-wfa",
  projectId: "project-s6-wfa",
  logicalNodeId: "logical-node-s6-wfa",
  registrationId: SubjectRegistrationId("sreg_s6_wfa"),
  subjectId: CatalogSubjectId("csub_acme_power"),
  definitionId: ParameterDefinitionId("pdef_acme_power_iin_max"),
  effectiveRevisionId: DefinitionRevisionId("drev_acme_power_iin_max_1"),
  catalogRelease: snapshotRelease,
  currentValueId: ProjectValueId("pval_placeholder"),
};

const throwingPool = {
  query: async () => {
    throw new Error("S6-WFA must not touch the store after a typed block");
  },
} as never;

const readCommand = (
  overrides: Partial<ProtectedReadCommand> = {},
): ProtectedReadCommand => ({
  snapshot,
  binding,
  definitionRevisionId: binding.effectiveRevisionId,
  ...overrides,
});

const writebackCommand = (
  overrides: Partial<ProtectedWritebackCommand> = {},
): ProtectedWritebackCommand => ({
  snapshot,
  binding,
  definitionRevisionId: binding.effectiveRevisionId,
  source: { sourceRef: "config-set:main", configRevisionId: "crev-1" },
  payload: { kind: "number", value: 1500 },
  expectedTip: binding.currentValueId,
  ...overrides,
});

describe("S6-WFA public command contract", () => {
  it("owns the frozen threat-matrix coverage and public read/writeback seam", () => {
    expect(THREAT_MATRIX).toHaveLength(7);
    expect(typeof readProtectedReference).toBe("function");
    expect(typeof writebackProtectedReference).toBe("function");
    expect(typeof createProtectedWorkflowAdapters).toBe("function");
  });

  it("does not export a repository, unit of work, transaction, or store adapter", async () => {
    const exported = await import("./index");
    expect("hasLegacyParameterSpecId" in exported).toBe(false);
    expect("toProtectedReferenceDto" in exported).toBe(false);
    expect("blocked" in exported).toBe(false);
    expect("requireBinding" in exported).toBe(false);
    expect(Object.keys(exported).some((key) => /repository/i.test(key))).toBe(false);
    expect(Object.keys(exported).some((key) => /unitOfWork|UnitOfWork|transaction/i.test(key))).toBe(
      false,
    );
    expect(Object.keys(exported).some((key) => /store/i.test(key))).toBe(false);
  });
});

describe("S6-WFA typed blocks before any store write", () => {
  it("refuses a parameterSpecId fallback on read and writeback", async () => {
    const legacyRead = {
      ...readCommand(),
      parameterSpecId: "spec-legacy-1",
    };
    const snakeRead = {
      ...readCommand(),
      parameter_spec_id: "spec-legacy-2",
    };
    const legacyWrite = {
      ...writebackCommand(),
      parameterSpecId: "spec-legacy-3",
    };

    const read = await readProtectedReference(throwingPool, legacyRead);
    const snake = await readProtectedReference(throwingPool, snakeRead);
    const write = await writebackProtectedReference(throwingPool, legacyWrite);

    expect(read).toEqual({
      ok: false,
      error: { kind: "typed-block", reason: "legacy-parameter-spec-id" },
    });
    expect(snake).toEqual({
      ok: false,
      error: { kind: "typed-block", reason: "legacy-parameter-spec-id" },
    });
    expect(write).toEqual({
      ok: false,
      error: { kind: "typed-block", reason: "legacy-parameter-spec-id" },
    });
  });

  it("blocks a missing Binding without inventing a pin", async () => {
    const read = await readProtectedReference(
      throwingPool,
      readCommand({ binding: null }),
    );
    const write = await writebackProtectedReference(
      throwingPool,
      writebackCommand({ binding: null }),
    );
    expect(read).toEqual({
      ok: false,
      error: { kind: "typed-block", reason: "missing-binding" },
    });
    expect(write).toEqual({
      ok: false,
      error: { kind: "typed-block", reason: "missing-binding" },
    });
  });

  it("blocks history/revision disagreement instead of substituting the snapshot head", async () => {
    const otherRevision = DefinitionRevisionId("drev_not_effective");
    const read = await readProtectedReference(
      throwingPool,
      readCommand({ definitionRevisionId: otherRevision }),
    );
    const write = await writebackProtectedReference(
      throwingPool,
      writebackCommand({ definitionRevisionId: otherRevision }),
    );
    const releaseMismatch = await readProtectedReference(
      throwingPool,
      readCommand({
        binding: {
          ...binding,
          catalogRelease: { ...snapshotRelease, digest: `sha256:${"c".repeat(64)}` },
        },
      }),
    );
    expect(read).toEqual({
      ok: false,
      error: { kind: "typed-block", reason: "revision-disagreement" },
    });
    expect(write).toEqual({
      ok: false,
      error: { kind: "typed-block", reason: "revision-disagreement" },
    });
    expect(releaseMismatch).toEqual({
      ok: false,
      error: { kind: "typed-block", reason: "revision-disagreement" },
    });
  });
});

describe("S6-WFA production Catalog isolation", () => {
  it("never selects or inserts Catalog structural rows and never falls back to parameterSpecId", () => {
    expect([...productionFiles].sort()).toEqual(
      ["dto.ts", "index.ts", "readAdapter.ts", "threatMatrix.ts", "writebackAdapter.ts"].sort(),
    );

    const sources = productionFiles.map((file) => ({
      file,
      source: readFileSync(path.join(dir, file), "utf8"),
    }));
    for (const { file, source } of sources) {
      expect(source, file).not.toContain("parameter_definitions");
      expect(source, file).not.toContain("project_parameter_values");
      expect(source, file).not.toContain("parameterSpecId");
      expect(source, file).not.toMatch(/pg_advisory_/);
      expect(source, file).not.toContain("assert_catalog_subject_active");
      expect(source, file).not.toContain("listDefinitionRevisions(");
      expect(source, file).not.toContain("selectedRevision");
      expect(source, file).not.toContain("stabilizeCanonicalBinding");
      expect(source, file).not.toContain("writeGuardedRegistration");
      expect(source, file).not.toContain("installPublishedRelease");
      expect(source, file).not.toContain("from \"../binding/repositories\"");
      expect(source, file).not.toContain("from \"../values/repositories\"");
      for (const token of catalogStructuralTokens) {
        expect(source, `${file} must not mention ${token}`).not.toContain(token);
      }
      expect(source, file).not.toMatch(/parameter_catalog\.[A-Za-z_][A-Za-z0-9_]*/);
      expect(source, file).not.toMatch(
        /insert into\s+parameter_catalog\.catalog_releases|select[\s\S]{0,80}from\s+parameter_catalog\.catalog_releases/i,
      );
    }

    const index = sources.find((entry) => entry.file === "index.ts");
    const dto = sources.find((entry) => entry.file === "dto.ts");
    const read = sources.find((entry) => entry.file === "readAdapter.ts");
    const write = sources.find((entry) => entry.file === "writebackAdapter.ts");
    expect(index?.source).not.toContain("from \"./repositories\"");
    expect(dto?.source).toContain("Binding");
    expect(dto?.source).toContain("ProjectValue");
    expect(dto?.source).toContain("canonical-pin");
    expect(read?.source).toContain("readProjectValueHistory");
    expect(write?.source).toContain("appendProjectValue");
    expect(write?.source).not.toContain("readProjectValueHistory");
    expect(read?.source).not.toContain("appendProjectValue");
  });
});
