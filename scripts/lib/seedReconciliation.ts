/**
 * Issue #849 decision 7 (seed reconciliation contract) and decision 10 (honest expected counts).
 *
 * Builds ONE deterministic seed manifest over the current seed/catalog inputs and renders ONE
 * human-readable reconciliation report. The manifest is the reviewed contract: every current-scope
 * input occurrence records its source (path + digest + locator), old identity when one exists, the
 * formal subject/selector, the property key, the allocated stable definition identity, the content
 * transformation and a `preserve | transform | merge | exclude` disposition with a reason. The eight
 * deferred compatibility items carry an explicit `defer` disposition linked to TD-124.
 *
 * Reuse boundary: vendor file selection, exclusion and the content-hash pin come from the production
 * `inventoryVendorCatalog`; canonical property identity comes from `parseCanonicalPropertyKey`; board
 * resolution comes from the DTS `resolveDts` / `resolveDtsConfigSet` parsers and the structural-key
 * predicate `isStructuralPropertyKey`. This module never re-implements a parser and never mutates a
 * source file. The only importer rule mirrored here is the `foldConstraints` allowed-key set that
 * blocks two vendor files, recorded as a required `transform` (see KNOWN_VENDOR_CONSTRAINT_BLOCKERS).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { danglingAnchorLabels, missingReferencedLabels } from "../../server/modules/dts/danglingAnchorStub";
import { resolveDtsConfigSet } from "../../server/modules/dts/configSetResolver";
import { resolveDts, type ResolvedDts } from "../../server/modules/dts/resolver";
import { inventoryVendorCatalog } from "../../server/modules/catalog-publication/import/vendorYaml";
import { parseCanonicalPropertyKey } from "../../server/modules/parameter-catalog-contract/normalization";
import { isStructuralPropertyKey } from "../../src/domain/parameter-topology/parameterSurface";

export const SEED_RECONCILIATION_MANIFEST_PATH = "src/config/seed-reconciliation/manifest.json";
export const SEED_RECONCILIATION_REPORT_PATH = "docs/generated/seed-reconciliation-report.md";
export const DEFERRED_TRACKER_ID = "TD-124";

const VENDOR_SCHEMAS_ROOT = "schemas/dts";
const POWER_MANAGEMENT_PATH = "src/config/power-management.json";
const BOARD_IDS = ["aurora", "nebula", "atlas"] as const;
type BoardId = (typeof BOARD_IDS)[number];
const BOARD_SOURCE_PATH: Readonly<Record<BoardId, string>> = Object.freeze({
  aurora: "src/config/dts-seed/aurora-board.dts",
  nebula: "src/config/dts-seed/nebula-board.dts",
  atlas: "src/config/dts-seed/atlas-board.dts",
});

export const DEFERRED_COMPATIBILITY_FORMATS = Object.freeze(["YAML", "TOML", "ENV"]);
export const CURRENT_COMPATIBILITY_FORMATS = Object.freeze(["JSON", "DTS"]);

export type SeedDisposition = "preserve" | "transform" | "merge" | "exclude";
export type SeedInputDisposition = SeedDisposition | "defer";

export type SourceRecord = {
  readonly path: string;
  readonly role:
    | "vendor-input"
    | "vendor-manifest"
    | "compatibility-source"
    | "compatibility-project-source"
    | "board-source";
  readonly sha256: string;
  readonly bytes: number;
};

export type FormalSubject = {
  readonly kind: "driver" | "nodename" | "compatibility-item";
  readonly value: string;
};

export type Transformation = {
  readonly kind: string;
  readonly detail: string;
  readonly [key: string]: unknown;
};

export type SeedInputRecord = {
  readonly inputId: string;
  readonly family: "vendor" | "compatibility";
  readonly scope: "current" | "deferred";
  readonly sourcePath: string;
  readonly sourceDigest: string;
  readonly sourceLocator: string;
  readonly sourceKind: "vendor-yaml-property" | "power-management-parameter-library-item";
  readonly oldIdentity: { readonly kind: string; readonly value: string } | null;
  readonly formalSubject: FormalSubject;
  readonly selector: string;
  readonly propertyKey: string;
  readonly formatFamily: string;
  readonly definitionId: string;
  readonly content: Readonly<Record<string, unknown>>;
  readonly transformation: Transformation;
  readonly disposition: SeedInputDisposition;
  readonly reason: string;
  readonly deferredTo?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly projectValues?: Readonly<Record<string, unknown>>;
  /**
   * Issue #849 C3: the reviewed real source file(s) and exact locator for a
   * current-scope compatibility item. Absent for deferred items, which own no
   * active source this round.
   */
  readonly realSource?: Readonly<Record<string, unknown>>;
  readonly blocked?: boolean;
};

export type BoardOccurrenceRecord = {
  readonly occurrenceId: string;
  readonly family: "board";
  readonly scope: "current" | "excluded";
  readonly board: BoardId;
  readonly sourcePath: string;
  readonly sourceDigest: string;
  readonly sourceLocator: string;
  readonly nodePath: string;
  readonly nodeName: string;
  readonly compatible: string | null;
  readonly oldIdentity: { readonly kind: string; readonly value: string } | null;
  readonly formalSubject: FormalSubject;
  readonly selector: string;
  readonly propertyKey: string;
  readonly definitionId: string | null;
  readonly content: Readonly<Record<string, unknown>>;
  readonly transformation: Transformation;
  readonly disposition: SeedDisposition;
  readonly reason: string;
  readonly mergesInto?: string;
  readonly valueDivergesFromDefiner?: boolean;
};

export type SeedReconciliationManifest = {
  readonly manifestKind: "wiseeff.seed-reconciliation";
  readonly manifestVersion: 1;
  readonly generator: string;
  readonly determinism: Readonly<Record<string, string>>;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly sources: readonly SourceRecord[];
  readonly summary: Readonly<Record<string, number | boolean>>;
  readonly dispositionCounts: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly vendorSelection: Readonly<Record<string, unknown>>;
  readonly inputs: readonly SeedInputRecord[];
  readonly excludedStructuralInputs: readonly Readonly<Record<string, unknown>>[];
  readonly boardOccurrences: readonly BoardOccurrenceRecord[];
  readonly knownBlockers: readonly Readonly<Record<string, unknown>>[];
  readonly reconDiscrepancies: Readonly<Record<string, unknown>>;
  readonly plannedInventory: Readonly<Record<string, unknown>>;
  readonly conservation: Readonly<Record<string, number | boolean>>;
};

export type SeedReconciliationArtifacts = {
  readonly manifest: SeedReconciliationManifest;
  readonly report: string;
};

const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const stableDefinitionId = (subject: FormalSubject, propertyKey: string): string =>
  `seeddef_${sha256Hex(`${subject.kind}:${subject.value}|${propertyKey}`).slice(0, 16)}`;

const formatFamilyOf = (configFormat: string): string => {
  const match = /^([A-Za-z]+)\s*:/u.exec(configFormat.trim());
  return match ? match[1]!.toUpperCase() : "UNKNOWN";
};

/** Mirrors `propertySourcePath` in scripts/dts-power-seed.ts (trivial locator formatting, not a parser). */
const dtsSeedSourcePath = (nodePath: string, propertyName: string): string =>
  nodePath === "" || nodePath === "/" ? propertyName : `${nodePath}/${propertyName}`;

const compareStrings = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

class SourceRegistry {
  private readonly records: SourceRecord[] = [];

  constructor(private readonly rootDir: string) {}

  read(relativePath: string, role: SourceRecord["role"]): { readonly content: string; readonly digest: string } {
    const absolute = path.join(this.rootDir, relativePath);
    const content = readFileSync(absolute, "utf8");
    const digest = sha256Hex(content);
    this.records.push({ path: relativePath, role, sha256: digest, bytes: Buffer.byteLength(content, "utf8") });
    return { content, digest };
  }

  all(): readonly SourceRecord[] {
    const unique = new Map<string, SourceRecord>();
    for (const record of this.records) {
      const existing = unique.get(record.path);
      if (existing && (existing.sha256 !== record.sha256 || existing.role !== record.role)) {
        throw new Error(`source ${record.path} was read with conflicting role or content`);
      }
      unique.set(record.path, record);
    }
    return [...unique.values()].sort((a, b) => compareStrings(a.path, b.path));
  }
}

type VendorDocument = {
  readonly $id?: unknown;
  readonly title?: unknown;
  readonly compatible?: unknown;
  readonly nodename?: unknown;
  readonly properties?: unknown;
};

const vendorSubject = (
  document: VendorDocument,
): { readonly subject: FormalSubject; readonly aliases: readonly string[]; readonly selector: string } => {
  const compatible = Array.isArray(document.compatible) ? document.compatible.filter((v) => typeof v === "string") : [];
  const nodename = Array.isArray(document.nodename) ? document.nodename.filter((v) => typeof v === "string") : [];
  if (compatible.length > 0 && nodename.length > 0) {
    throw new Error("vendor document declares both compatible and nodename");
  }
  if (compatible.length > 0) {
    return {
      subject: { kind: "driver", value: compatible[0]! },
      aliases: compatible.slice(1),
      selector: `compatible=${compatible[0]!}`,
    };
  }
  if (nodename.length > 0) {
    return {
      subject: { kind: "nodename", value: nodename[0]! },
      aliases: nodename.slice(1),
      selector: `nodename=${nodename[0]!}`,
    };
  }
  throw new Error("vendor document declares neither compatible nor nodename");
};

/**
 * Mirrors the production `foldConstraints` (`vendorAdapter.ts`) blocker rule. The allowed-key set is
 * the only importer rule duplicated here; it is recorded as the exact required transformation rather
 * than being repaired in the source or the importer.
 */
const unhandledVendorConstraints = (constraints: unknown): readonly string[] => {
  if (constraints === null || typeof constraints !== "object" || Array.isArray(constraints)) return [];
  const keys = Object.keys(constraints);
  if (keys.length === 0) return [];
  const allowed = new Set(["minimum", "maximum"]);
  return keys.filter((key) => !allowed.has(key)).sort();
};

const buildVendorInputs = (
  rootDir: string,
  registry: SourceRegistry,
): {
  readonly inputs: readonly SeedInputRecord[];
  readonly excludedStructuralInputs: readonly Readonly<Record<string, unknown>>[];
  readonly rawPropertyEntries: number;
  readonly inputFiles: readonly string[];
  readonly catalogDigest: string;
  readonly blockers: readonly Readonly<Record<string, unknown>>[];
  readonly inventory: ReturnType<typeof inventoryVendorCatalog>;
} => {
  const inventory = inventoryVendorCatalog(path.join(rootDir, VENDOR_SCHEMAS_ROOT));
  if (!inventory.ok) {
    throw new Error(`vendor inventory is not clean: ${JSON.stringify(inventory.error)}`);
  }
  const catalogSource = registry.read(`${VENDOR_SCHEMAS_ROOT}/catalog.json`, "vendor-manifest");
  const inputFiles = inventory.value.files
    .filter((file) => file.disposition === "input")
    .map((file) => file.relativePath)
    .sort(compareStrings);

  const inputs: SeedInputRecord[] = [];
  const excludedStructuralInputs: Array<Readonly<Record<string, unknown>>> = [];
  const blockers: Array<Readonly<Record<string, unknown>>> = [];
  let rawPropertyEntries = 0;

  for (const relativePath of inputFiles) {
    const sourcePath = `${VENDOR_SCHEMAS_ROOT}/${relativePath}`;
    const { content, digest } = registry.read(sourcePath, "vendor-input");
    const document = parseYaml(content) as VendorDocument;
    const { subject, aliases, selector } = vendorSubject(document);
    const properties =
      document.properties !== null && typeof document.properties === "object" && !Array.isArray(document.properties)
        ? (document.properties as Record<string, Record<string, unknown>>)
        : {};

    for (const propertyKey of Object.keys(properties).sort(compareStrings)) {
      rawPropertyEntries += 1;
      const property = properties[propertyKey] ?? {};
      const sourceLocator = `${relativePath}#${propertyKey}`;
      const parsedKey = parseCanonicalPropertyKey(propertyKey);
      if (!parsedKey.ok) {
        excludedStructuralInputs.push({
          inputId: `vendor-excluded:${sourceLocator}`,
          family: "vendor",
          scope: "excluded",
          sourcePath,
          sourceDigest: digest,
          sourceLocator,
          propertyKey,
          disposition: "exclude",
          reason: `parseCanonicalPropertyKey:${parsedKey.error}`,
        });
        continue;
      }

      const extras = unhandledVendorConstraints(property.constraints);
      const blocked = extras.length > 0;
      const constraints = property.constraints as Readonly<Record<string, unknown>> | undefined;
      const content: Record<string, unknown> = {
        valueShape: property.valueShape ?? null,
        units: property.units ?? null,
        documentation: property.documentation ?? null,
        constraints: constraints ?? null,
        hasExampleValue: Object.prototype.hasOwnProperty.call(property, "exampleValue"),
        hasDefault: Object.prototype.hasOwnProperty.call(property, "default"),
      };

      if (blocked) {
        const blockerPath = `${relativePath}#${propertyKey}.constraints.${extras[0]!}`;
        const detail = `unhandled-constraint:${extras.join(",")}`;
        const cells = constraints?.cells ?? null;
        const constraintDescription = constraints?.description ?? null;
        blockers.push({
          sourcePath,
          sourceDigest: digest,
          sourceLocator,
          propertyKey,
          blockerPath,
          detail,
          disposition: "transform",
          exactTransformation:
            "Preserve every constraint key. Fold constraints.cells into integer array cardinality bounds (minItems=maxItems=cells) on the mapped value schema and fold constraints.description into the schema description annotation; extend foldConstraints' allowed-key set to accept cells/description. Do NOT delete cells or description from the vendor YAML and do NOT modify the importer in this deliverable.",
        });
        inputs.push({
          inputId: `vendor:${sourceLocator}`,
          family: "vendor",
          scope: "current",
          sourcePath,
          sourceDigest: digest,
          sourceLocator,
          sourceKind: "vendor-yaml-property",
          oldIdentity: { kind: "vendor-definition-path", value: sourceLocator },
          formalSubject: subject,
          selector,
          propertyKey,
          formatFamily: "DTS-YAML",
          definitionId: stableDefinitionId(subject, propertyKey),
          content: { ...content, aliases },
          transformation: {
            kind: "vendor-constraint-fold",
            requiredBeforeImport: true,
            detail:
              "Fold constraints.cells and constraints.description into the mapped value schema without dropping either; source YAML stays unchanged.",
            input: { valueShape: property.valueShape ?? null, constraints: constraints ?? null },
            output: {
              type: "array",
              items: { description: String(property.valueShape ?? "mixed") },
              minItems: cells,
              maxItems: cells,
              description: constraintDescription,
            },
            blocker: { code: "import-blocked", detail, path: blockerPath },
          },
          disposition: "transform",
          reason: `Production importer blocks this entry (${detail}); a content-preserving constraint fold is required before it can be imported into the current round.`,
          blocked: true,
        });
        continue;
      }

      inputs.push({
        inputId: `vendor:${sourceLocator}`,
        family: "vendor",
        scope: "current",
        sourcePath,
        sourceDigest: digest,
        sourceLocator,
        sourceKind: "vendor-yaml-property",
        oldIdentity: { kind: "vendor-definition-path", value: sourceLocator },
        formalSubject: subject,
        selector,
        propertyKey,
        formatFamily: "DTS-YAML",
        definitionId: stableDefinitionId(subject, propertyKey),
        content: { ...content, aliases },
        transformation: {
          kind: "identity-allocated-content-preserved",
          detail:
            "Vendor property metadata maps to the new stable definition identity unchanged; only the definition id is newly allocated.",
        },
        disposition: "preserve",
        reason: "Canonical vendor property in the current round; identity and content are carried over unchanged.",
      });
    }
  }

  inputs.sort((a, b) => compareStrings(a.inputId, b.inputId));
  excludedStructuralInputs.sort((a, b) => compareStrings(String(a.sourceLocator), String(b.sourceLocator)));
  blockers.sort((a, b) => compareStrings(String(a.sourceLocator), String(b.sourceLocator)));
  return { inputs, excludedStructuralInputs, rawPropertyEntries, inputFiles, catalogDigest: catalogSource.digest, blockers, inventory };
};

type PowerManagementItem = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly explanation: string;
  readonly configFormat: string;
  readonly module: string;
  readonly range: string;
  readonly unit: string;
  readonly risk: string;
  readonly valueKind: string;
  readonly values: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
};

/**
 * Issue #849 C3: reviewed real source files for the four current-scope
 * compatibility items. DTS property keys are hyphenated in the source while the
 * retired seed names are underscored; JSON keys are literal dotted strings.
 */
const COMPATIBILITY_SOURCE_ROOT = "src/config/seed-sources";
const COMPATIBILITY_SOURCE_PROJECTS = ["atlas", "aurora", "nebula"] as const;

const COMPATIBILITY_REAL_SOURCE: Record<
  string,
  {
    readonly fileName: string;
    readonly format: "json" | "dts";
    readonly locator: string;
    readonly subjectSelection: string;
  }
> = {
  charge_voltage_limit_mv: {
    fileName: "power-config.json",
    format: "json",
    locator: "charger.cv.limitMv",
    subjectSelection: "requires-configuration-schema-subject",
  },
  battery_temp_target_c: {
    fileName: "power-config.json",
    format: "json",
    locator: "battery.thermal.targetTempC",
    subjectSelection: "requires-configuration-schema-subject",
  },
  dts_fast_charge_profile_matrix: {
    fileName: "charging-thermal.dts",
    format: "dts",
    locator: "charging_core/fast-charge-profile-matrix",
    subjectSelection: "pending-reviewed-subject-selection",
  },
  battery_thermal_derate_curve: {
    fileName: "charging-thermal.dts",
    format: "dts",
    locator: "charging_core/battery-thermal-derate-curve",
    subjectSelection: "pending-reviewed-subject-selection",
  },
};

const buildCompatibilityInputs = (
  rootDir: string,
  registry: SourceRegistry,
): {
  readonly inputs: readonly SeedInputRecord[];
  readonly deferred: readonly SeedInputRecord[];
} => {
  const { content, digest } = registry.read(POWER_MANAGEMENT_PATH, "compatibility-source");
  const parsed = JSON.parse(content) as { parameterLibrary?: unknown };
  if (!Array.isArray(parsed.parameterLibrary)) {
    throw new Error(`${POWER_MANAGEMENT_PATH} is missing a parameterLibrary array`);
  }
  const items = parsed.parameterLibrary as PowerManagementItem[];
  const inputs: SeedInputRecord[] = [];

  items.forEach((item, index) => {
    for (const field of [
      "id",
      "name",
      "description",
      "explanation",
      "configFormat",
      "module",
      "range",
      "unit",
      "risk",
      "valueKind",
      "values",
    ] as const) {
      if (item[field] === undefined || item[field] === null) {
        throw new Error(`${POWER_MANAGEMENT_PATH}#/parameterLibrary/${index} is missing ${field}`);
      }
    }
    const sourceLocator = `/parameterLibrary/${index}`;
    const formatFamily = formatFamilyOf(item.configFormat);
    const scope = CURRENT_COMPATIBILITY_FORMATS.includes(formatFamily) ? "current" : "deferred";
    const subject: FormalSubject = { kind: "compatibility-item", value: item.id };
    const projectValues = Object.fromEntries(
      Object.keys(item.values)
        .sort(compareStrings)
        .map((projectId) => {
          const value = item.values[projectId] ?? {};
          return [
            projectId,
            {
              currentValue: value.currentValue ?? null,
              recommendedValue: value.recommendedValue ?? null,
              // Relative display label copied verbatim; deliberately NOT a timestamp field.
              updatedAtDisplayLabel: value.updatedAt ?? null,
            },
          ];
        }),
    );
    const metadata = {
      module: item.module,
      description: item.description,
      explanation: item.explanation,
      range: item.range,
      unit: item.unit,
      risk: item.risk,
      valueKind: item.valueKind,
    };
    const base = {
      inputId: `compatibility:${sourceLocator}`,
      family: "compatibility" as const,
      sourcePath: POWER_MANAGEMENT_PATH,
      sourceDigest: digest,
      sourceLocator,
      sourceKind: "power-management-parameter-library-item" as const,
      oldIdentity: { kind: "power-management-id", value: item.id },
      formalSubject: subject,
      selector: `power-management:${item.id}`,
      propertyKey: item.name,
      formatFamily,
      definitionId: stableDefinitionId(subject, item.name),
      content: {
        configFormat: item.configFormat,
        description: item.description,
        explanation: item.explanation,
        range: item.range,
        unit: item.unit,
        risk: item.risk,
        valueKind: item.valueKind,
      },
      metadata,
      projectValues,
    };
    if (scope === "current") {
      const spec = COMPATIBILITY_REAL_SOURCE[item.name];
      const realSource = spec
        ? {
            kind: "reviewed-project-source",
            format: spec.format,
            locator: spec.locator,
            subjectSelection: spec.subjectSelection,
            files: COMPATIBILITY_SOURCE_PROJECTS.map((project) => {
              const relativePath = `${COMPATIBILITY_SOURCE_ROOT}/${project}/${spec.fileName}`;
              const file = registry.read(relativePath, "compatibility-project-source");
              return {
                project,
                path: relativePath,
                digest: file.digest,
                locator: spec.locator,
                currentValue: item.values[project]?.currentValue ?? null,
                recommendedValue: item.values[project]?.recommendedValue ?? null,
              };
            }),
          }
        : undefined;
      inputs.push({
        ...base,
        ...(realSource ? { realSource } : {}),
        scope: "current",
        transformation: {
          kind: "identity-allocated-content-preserved",
          detail:
            "Compatibility item content and project values are carried over unchanged; the old slug id is retained as oldIdentity and a stable definition identity is allocated from the property key.",
        },
        disposition: "preserve",
        reason: `${formatFamily} compatibility item is in the current round; identity and content are carried over unchanged.`,
      });
    } else {
      inputs.push({
        ...base,
        scope: "deferred",
        transformation: {
          kind: "deferred-no-seed-this-round",
          detail:
            "Content is retained verbatim (metadata plus per-project current/recommended values) for the deferred round; it creates no seeded binding or value this round.",
        },
        disposition: "defer",
        deferredTo: DEFERRED_TRACKER_ID,
        reason: `${formatFamily} compatibility item is out of the current round (JSON/DTS only); deferred to ${DEFERRED_TRACKER_ID} with metadata and project values retained.`,
      });
    }
  });

  inputs.sort((a, b) => compareStrings(a.inputId, b.inputId));
  return { inputs, deferred: inputs.filter((entry) => entry.disposition === "defer") };
};

type BoardBuild = {
  readonly occurrences: readonly BoardOccurrenceRecord[];
  readonly perBoard: Readonly<Record<BoardId, Readonly<Record<string, number>>>>;
  readonly danglingLabels: readonly string[];
  readonly danglingDiagnosticCount: number;
  readonly missingReferencedLabels: number;
  readonly nodes: number;
};

const buildBoardOccurrences = (rootDir: string, registry: SourceRegistry): BoardBuild => {
  const occurrences: BoardOccurrenceRecord[] = [];
  const perBoard: Record<BoardId, Record<string, number>> = {} as Record<BoardId, Record<string, number>>;
  let danglingLabels: readonly string[] = [];
  let danglingDiagnosticCount = 0;
  let missingCount = 0;
  let nodeCount = 0;

  for (const board of BOARD_IDS) {
    const sourcePath = BOARD_SOURCE_PATH[board];
    const { content, digest } = registry.read(sourcePath, "board-source");
    const resolved: ResolvedDts = resolveDts(content);
    nodeCount = resolved.nodes.length;
    const configSet = resolveDtsConfigSet({
      entryFile: path.basename(sourcePath),
      includeSearchPaths: [],
      overlayOrder: [],
      files: new Map([[path.basename(sourcePath), { fileVersionId: "seed-reconciliation", content }]]),
    });
    const dangling = configSet.diagnostics.filter((diagnostic) => diagnostic.code === "dangling-reference");
    danglingDiagnosticCount = dangling.length;
    danglingLabels = danglingAnchorLabels(configSet.diagnostics);
    missingCount = missingReferencedLabels(content).length;

    let raw = 0;
    let business = 0;
    let structural = 0;
    let phandleRefs = 0;
    let merges = 0;
    const definerByDefinition = new Map<string, BoardOccurrenceRecord>();
    const boardOccurrences: BoardOccurrenceRecord[] = [];

    for (const node of resolved.nodes) {
      phandleRefs += node.phandleRefs.length;
      const subject: FormalSubject = node.compatible
        ? { kind: "driver", value: node.compatible }
        : { kind: "nodename", value: node.name };
      const selector = node.compatible ? `compatible=${node.compatible}` : `nodename=${node.name}`;
      for (const property of node.properties) {
        raw += 1;
        const structuralKey = isStructuralPropertyKey(property.name);
        const sourceLocator = `${node.nodePath}#${property.name}`;
        const base = {
          occurrenceId: `board:${board}:${sourceLocator}`,
          family: "board" as const,
          board,
          sourcePath,
          sourceDigest: digest,
          sourceLocator,
          nodePath: node.nodePath,
          nodeName: node.name,
          compatible: node.compatible ?? null,
          oldIdentity: {
            kind: "dts-seed-source-path",
            value: dtsSeedSourcePath(node.nodePath, property.name),
          },
          formalSubject: subject,
          selector,
          propertyKey: property.name,
          content: {
            valueType: property.valueType,
            rawText: property.rawText,
            normalizedValue: property.normalizedValue,
          },
        };
        if (structuralKey) {
          structural += 1;
          boardOccurrences.push({
            ...base,
            scope: "excluded",
            definitionId: null,
            transformation: {
              kind: "structural-excluded",
              detail: "Structural DTS key; never a parameter-surface definition or binding (isStructuralPropertyKey).",
            },
            disposition: "exclude",
            reason: "isStructuralPropertyKey: structural keys are excluded from the parameter surface.",
          });
          continue;
        }
        business += 1;
        const definitionId = stableDefinitionId(subject, property.name);
        const definer = definerByDefinition.get(definitionId);
        if (!definer) {
          const record: BoardOccurrenceRecord = {
            ...base,
            scope: "current",
            definitionId,
            transformation: {
              kind: "seed-row-projection",
              detail:
                "Board property becomes a project binding on the shared definition; the parsed value is preserved as the project value.",
            },
            disposition: "preserve",
            reason: `First occurrence of definition ${definitionId} in ${board}; definition identity allocated and the occurrence becomes a binding.`,
          };
          definerByDefinition.set(definitionId, record);
          boardOccurrences.push(record);
          continue;
        }
        merges += 1;
        const diverges = definer.content.normalizedValue !== property.normalizedValue;
        boardOccurrences.push({
          ...base,
          scope: "current",
          definitionId,
          transformation: {
            kind: "merge-occurrence-into-definition",
            detail: diverges
              ? "Same formal subject + property key as an earlier occurrence, but the instance value differs; the occurrence is preserved as its own project binding and must not overwrite the definition value."
              : "Same formal subject + property key and identical value as an earlier occurrence; preserved as a binding on the same definition.",
          },
          disposition: "merge",
          reason: `Occurrence shares definition ${definitionId} with ${definer.occurrenceId}; recorded once as a binding, not a second definition.`,
          mergesInto: definer.occurrenceId,
          valueDivergesFromDefiner: diverges,
        });
      }
    }

    boardOccurrences.sort((a, b) => compareStrings(a.sourceLocator, b.sourceLocator));
    occurrences.push(...boardOccurrences);
    perBoard[board] = {
      nodes: resolved.nodes.length,
      rawPropertyOccurrences: raw,
      businessOccurrences: business,
      structuralOccurrences: structural,
      phandleRefs,
      distinctBusinessDefinitions: definerByDefinition.size,
      mergeOccurrences: merges,
    };
  }

  return {
    occurrences,
    perBoard,
    danglingLabels: [...danglingLabels].sort(compareStrings),
    danglingDiagnosticCount,
    missingReferencedLabels: missingCount,
    nodes: nodeCount,
  };
};

const countBy = <T>(values: readonly T[], key: (value: T) => string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const k = key(value);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
};

export const buildSeedReconciliation = (rootDir: string = process.cwd()): SeedReconciliationArtifacts => {
  const registry = new SourceRegistry(rootDir);
  const vendor = buildVendorInputs(rootDir, registry);
  const compatibility = buildCompatibilityInputs(rootDir, registry);
  const boards = buildBoardOccurrences(rootDir, registry);

  const inputs = [...vendor.inputs, ...compatibility.inputs].sort((a, b) =>
    compareStrings(a.inputId, b.inputId),
  );
  const currentInputs = inputs.filter((entry) => entry.scope === "current");
  const deferredInputs = inputs.filter((entry) => entry.scope === "deferred");
  const businessOccurrences = boards.occurrences.filter((entry) => entry.scope === "current");
  const excludedOccurrences = boards.occurrences.filter((entry) => entry.scope === "excluded");

  const definitions = new Set<string>();
  for (const entry of currentInputs) definitions.add(entry.definitionId);
  for (const entry of businessOccurrences) if (entry.definitionId) definitions.add(entry.definitionId);

  const boardBusinessPerProject = BOARD_IDS[0] ? boards.perBoard[BOARD_IDS[0]].businessOccurrences : 0;
  const plannedBindingsPerProject = boardBusinessPerProject + compatibility.inputs.filter((e) => e.scope === "current").length;
  const distinctBoardDefinitions = new Set(
    businessOccurrences.map((entry) => entry.definitionId).filter((id): id is string => id !== null),
  ).size;

  const manifest: SeedReconciliationManifest = {
    manifestKind: "wiseeff.seed-reconciliation",
    manifestVersion: 1,
    generator: "scripts/seed-reconciliation-manifest.ts",
    determinism: {
      ordering: "arrays are sorted by stable ids; the payload is serialized with 2-space indent and a trailing newline",
      timestamps: "no generation timestamp is embedded in the compared payload, so repeated runs are byte-identical",
      digests: "sha256 over the exact UTF-8 bytes of each referenced source file",
      definitionIdentity: "seeddef_<16 hex> = sha256('<subjectKind>:<subjectValue>|<propertyKey>')",
    },
    scope: {
      issue: "#849",
      decisions: ["decision 7 seed reconciliation contract", "decision 10 honest expected counts"],
      currentRoundFormats: ["vendor DTS-YAML", "JSON", "DTS"],
      deferredCompatibilityFormats: DEFERRED_COMPATIBILITY_FORMATS,
      deferredTrackerId: DEFERRED_TRACKER_ID,
      dispositionVocabulary: ["preserve", "transform", "merge", "exclude"],
      deferredDisposition: "defer",
      currentRoundRule:
        "All 113 canonical vendor definitions plus the 4 power-management.json items whose configFormat family is JSON or DTS are the current round; the 8 YAML/TOML/ENV compatibility items are deferred to TD-124 and create no seeded binding or value this round.",
      countsArePlanned:
        "The binding counts under plannedInventory are PLANNED counts derived from this manifest. They are not achieved runtime facts and are not asserted as such.",
    },
    sources: registry.all(),
    summary: {
      totalInputs: inputs.length,
      vendorInputs: vendor.inputs.length,
      compatibilityInputs: compatibility.inputs.length,
      currentInputs: currentInputs.length,
      deferredInputs: deferredInputs.length,
      vendorRawPropertyEntries: vendor.rawPropertyEntries,
      vendorStructuralExcluded: vendor.excludedStructuralInputs.length,
      compatibilityCurrentInputs: compatibility.inputs.filter((e) => e.scope === "current").length,
      boardFiles: BOARD_IDS.length,
      boardNodesPerProject: boards.nodes,
      boardRawPropertyOccurrencesPerProject: boards.perBoard[BOARD_IDS[0]]?.rawPropertyOccurrences ?? 0,
      boardBusinessOccurrencesPerProject: boardBusinessPerProject,
      boardStructuralOccurrencesPerProject: boards.perBoard[BOARD_IDS[0]]?.structuralOccurrences ?? 0,
      boardPhandleRefsPerProject: boards.perBoard[BOARD_IDS[0]]?.phandleRefs ?? 0,
      distinctBoardBusinessDefinitions: distinctBoardDefinitions,
      distinctDefinitions: definitions.size,
      knownBlockers: vendor.blockers.length,
      danglingOverlayTargetsPerBoard: boards.danglingLabels.length,
      missingReferencedLabelsPerBoard: boards.missingReferencedLabels,
    },
    dispositionCounts: {
      vendor: countBy(vendor.inputs, (entry) => entry.disposition),
      compatibilityCurrent: countBy(
        compatibility.inputs.filter((entry) => entry.scope === "current"),
        (entry) => entry.disposition,
      ),
      compatibilityDeferred: countBy(compatibility.deferred, (entry) => entry.disposition),
      boardOccurrences: countBy(boards.occurrences, (entry) => entry.disposition),
    },
    vendorSelection: {
      catalogPath: `${VENDOR_SCHEMAS_ROOT}/catalog.json`,
      catalogDigest: vendor.catalogDigest,
      schemaPathsListed: vendor.inventory.ok ? vendor.inventory.value.schemaPaths.length : null,
      inputFiles: vendor.inputFiles.length,
      excludedBasenames: ["common-status.yaml", "test-ambiguous-a.yaml", "test-ambiguous-b.yaml"],
      excludedReason:
        "EXCLUDED_SCHEMA_BASENAMES in server/modules/catalog-publication/import/vendorYaml.ts; selection is schemaPaths-driven, not a directory walk",
      vendorContentHash: vendor.inventory.ok ? vendor.inventory.value.vendorContentHash : null,
      observedDirectoryHash: vendor.inventory.ok ? vendor.inventory.value.observedDirectoryHash : null,
      hashPinned: vendor.inventory.ok
        ? vendor.inventory.value.vendorContentHash === vendor.inventory.value.observedDirectoryHash
        : false,
    },
    inputs,
    excludedStructuralInputs: vendor.excludedStructuralInputs,
    boardOccurrences: boards.occurrences,
    knownBlockers: vendor.blockers,
    reconDiscrepancies: {
      danglingOverlayTargets: {
        claimUnderReview: "The plan/recon reference to 24 dangling overlay targets per board.",
        reproducible: false,
        measured: {
          distinctUnresolvedOverlayTargetsPerBoard: boards.danglingLabels.length,
          danglingReferenceDiagnosticsPerBoard: boards.danglingDiagnosticCount,
          missingReferencedLabelsPerBoard: boards.missingReferencedLabels,
          labels: boards.danglingLabels,
        },
        method:
          "resolveDtsConfigSet(...).diagnostics filtered to code==='dangling-reference' (danglingAnchorLabels) plus missingReferencedLabels(source) per committed board file",
        statement:
          "The '24 dangling overlay targets' figure is NOT reproducible in this worktree. This manifest records the measured value: 29 distinct unresolved &label overlay targets and 37 missing &name references per board. The number 24 matches the stale '24 repeated property keys' prose in docs/design-docs/2026-07-16-parameter-topology-schema-management-design.md, now 26 in committed code assertions; it is not a dangling-label count.",
      },
      parameterLibraryShape: {
        claimUnderReview: "power-management.json parameterLibrary items carrying propertyKey / constraints / examples fields.",
        reproducible: false,
        measured:
          "Items carry id, name (which IS the DTS-style property key), description, explanation, configFormat, module, range, unit, risk, valueKind and values.{atlas,aurora,nebula}.{currentValue,recommendedValue,updatedAt}; range is the only constraint field and there is no propertyKey field.",
      },
      relativeUpdatedAtLabels: {
        note: "values.*.updatedAt holds relative display labels (e.g. '1 小时前'). They are retained verbatim as updatedAtDisplayLabel and are never copied into a timestamp field.",
      },
    },
    plannedInventory: {
      status: "PLANNED — derived from this manifest, not an achieved runtime fact",
      perProject: {
        boardBusinessOccurrences: boardBusinessPerProject,
        currentCompatibilityItems: compatibility.inputs.filter((e) => e.scope === "current").length,
        bindings: plannedBindingsPerProject,
        distinctBoardDefinitions: distinctBoardDefinitions,
      },
      threeProjects: {
        boardBusinessOccurrences: boardBusinessPerProject * BOARD_IDS.length,
        bindings: plannedBindingsPerProject * BOARD_IDS.length,
      },
      deferredItemsCreateSeedRows: false,
      definition:
        "A binding is one project-scoped instance of a definition; repeated board occurrences with the same subject + property key are separate bindings on one definition.",
    },
    conservation: {
      inputsRecorded: inputs.length,
      inputsExpected: 125,
      vendorInputsRecorded: vendor.inputs.length,
      vendorInputsExpected: 113,
      compatibilityInputsRecorded: compatibility.inputs.length,
      compatibilityInputsExpected: 12,
      currentInputsRecorded: currentInputs.length,
      currentInputsExpected: 117,
      deferredInputsRecorded: deferredInputs.length,
      deferredInputsExpected: 8,
      vendorRawPropertyEntriesRecorded: vendor.rawPropertyEntries,
      vendorRawEqualsCanonicalPlusStructural:
        vendor.rawPropertyEntries === vendor.inputs.length + vendor.excludedStructuralInputs.length,
      vendorInventoryItemsRecorded: vendor.inputs.length + vendor.excludedStructuralInputs.length,
      compatibilityItemsRecorded: compatibility.inputs.length,
      boardOccurrencesRecorded: boards.occurrences.length,
      boardBusinessOccurrencesRecorded: businessOccurrences.length,
      boardStructuralOccurrencesRecorded: excludedOccurrences.length,
      boardOccurrencesPerProject: BOARD_IDS.length > 0 ? boards.occurrences.length / BOARD_IDS.length : 0,
      everyInputRecordedExactlyOnce: new Set(inputs.map((entry) => entry.inputId)).size === inputs.length,
      everyBoardOccurrenceRecordedExactlyOnce:
        new Set(boards.occurrences.map((entry) => entry.occurrenceId)).size === boards.occurrences.length,
      everyBoardBusinessOccurrenceRecordedExactlyOnce:
        new Set(businessOccurrences.map((entry) => entry.occurrenceId)).size === businessOccurrences.length,
      everyStructuralVendorEntryRecordedExactlyOnce:
        new Set(vendor.excludedStructuralInputs.map((entry) => String(entry.inputId))).size ===
        vendor.excludedStructuralInputs.length,
    },
  };

  return { manifest, report: renderSeedReconciliationReport(manifest) };
};

const table = (headers: readonly string[], rows: readonly (readonly (string | number)[])[]): string => {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\|/gu, "\\|")).join(" | ")} |`),
  ];
  return lines.join("\n");
};

export const renderSeedReconciliationReport = (manifest: SeedReconciliationManifest): string => {
  const summary = manifest.summary;
  const num = (key: string): number => Number(summary[key]);
  const libraryIndex = (entry: SeedInputRecord): number =>
    Number(entry.sourceLocator.replace("/parameterLibrary/", ""));
  const currentCompatibility = manifest.inputs
    .filter((entry) => entry.family === "compatibility" && entry.scope === "current")
    .sort((a, b) => libraryIndex(a) - libraryIndex(b));
  const deferred = manifest.inputs
    .filter((entry) => entry.scope === "deferred")
    .sort((a, b) => libraryIndex(a) - libraryIndex(b));
  const boardRows = BOARD_IDS.map((board) => {
    const perBoard = manifest.boardOccurrences.filter((entry) => entry.board === board);
    const business = perBoard.filter((entry) => entry.scope === "current");
    const structural = perBoard.filter((entry) => entry.scope === "excluded");
    return [
      board,
      summary.boardNodesPerProject as number,
      perBoard.length,
      business.length,
      structural.length,
      business.filter((entry) => entry.disposition === "merge").length,
    ] as const;
  });

  const dispositionRows = Object.entries(manifest.dispositionCounts).flatMap(([family, counts]) =>
    Object.entries(counts)
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([disposition, count]) => [family, disposition, count] as const),
  );

  const measured = manifest.reconDiscrepancies.danglingOverlayTargets as {
    measured: { distinctUnresolvedOverlayTargetsPerBoard: number; missingReferencedLabelsPerBoard: number };
    statement: string;
  };

  return [
    "# Seed reconciliation report",
    "",
    "<!-- Generated by scripts/seed-reconciliation-manifest.ts via `npm run seed:reconcile`. Do not edit by hand. -->",
    "<!-- Deterministic artifact: it embeds no generation timestamp, so `npm run seed:reconcile:check` is byte-exact. -->",
    "",
    "Issue #849 decision 7 (seed reconciliation contract) and decision 10 (honest expected counts).",
    "One reviewed manifest (`src/config/seed-reconciliation/manifest.json`) and this report are generated",
    "together from the current seed/catalog inputs. The manifest carries the source digests; this report is",
    "the human-readable projection. Both are checked in and verified by `npm run seed:reconcile:check`.",
    "",
    "## Scope and expected counts",
    "",
    table(
      ["Measure", "Planned", "Measured"],
      [
        ["Total inputs", 125, num("totalInputs")],
        ["Vendor inputs", 113, num("vendorInputs")],
        ["Compatibility inputs", 12, num("compatibilityInputs")],
        ["Current round", 117, num("currentInputs")],
        ["Deferred to TD-124", 8, num("deferredInputs")],
        ["Vendor raw property entries", 135, num("vendorRawPropertyEntries")],
        ["Vendor structural entries excluded", 22, num("vendorStructuralExcluded")],
      ],
    ),
    "",
    "Binding counts are PLANNED counts derived from the manifest, not achieved runtime facts.",
    "",
    table(
      ["Planned inventory", "Per project", "Three projects"],
      [
        [
          "Board business occurrences",
          (manifest.plannedInventory.perProject as Record<string, number>).boardBusinessOccurrences,
          (manifest.plannedInventory.threeProjects as Record<string, number>).boardBusinessOccurrences,
        ],
        [
          "Current compatibility items",
          (manifest.plannedInventory.perProject as Record<string, number>).currentCompatibilityItems,
          (manifest.plannedInventory.perProject as Record<string, number>).currentCompatibilityItems * 3,
        ],
        [
          "Bindings",
          (manifest.plannedInventory.perProject as Record<string, number>).bindings,
          (manifest.plannedInventory.threeProjects as Record<string, number>).bindings,
        ],
      ],
    ),
    "",
    "## Dispositions",
    "",
    table(["Family", "Disposition", "Count"], dispositionRows),
    "",
    "## Current-round compatibility items (JSON / DTS)",
    "",
    table(
      ["Index", "Old id", "Property key", "Format", "Disposition", "Definition identity"],
      currentCompatibility.map((entry) => [
        entry.sourceLocator.replace("/parameterLibrary/", ""),
        entry.oldIdentity?.value ?? "",
        entry.propertyKey,
        entry.formatFamily,
        entry.disposition,
        entry.definitionId,
      ]),
    ),
    "",
    "## Deferred compatibility items (TD-124)",
    "",
    "These items are explicitly deferred. They retain their original metadata and per-project values and",
    "create no seeded binding or value this round.",
    "",
    table(
      ["Index", "Old id", "Property key", "Format", "Module", "Range", "Unit", "Risk", "Value kind", "Deferred to"],
      deferred.map((entry) => {
        const metadata = (entry.metadata ?? {}) as Record<string, string>;
        return [
          entry.sourceLocator.replace("/parameterLibrary/", ""),
          entry.oldIdentity?.value ?? "",
          entry.propertyKey,
          entry.formatFamily,
          metadata.module ?? "",
          metadata.range ?? "",
          metadata.unit ?? "",
          metadata.risk ?? "",
          metadata.valueKind ?? "",
          entry.deferredTo ?? "",
        ];
      }),
    ),
    "",
    "## Board reconciliation",
    "",
    table(
      ["Board", "Nodes", "Raw property occurrences", "Business", "Structural", "Merge occurrences"],
      boardRows,
    ),
    "",
    `Business vs structural is decided by \`isStructuralPropertyKey\` (src/domain/parameter-topology/parameterSurface.ts).`,
    `Each board records ${summary.boardPhandleRefsPerProject} phandle references.`,
    "",
    "## Known blockers (recorded as a required transform)",
    "",
    table(
      ["Source locator", "Blocker path", "Detail", "Disposition"],
      manifest.knownBlockers.map((blocker) => [
        String(blocker.sourceLocator),
        String(blocker.blockerPath),
        String(blocker.detail),
        String(blocker.disposition),
      ]),
    ),
    "",
    "The two `gpio_int` entries declare `constraints: { cells, description }`. The production importer",
    "(`foldConstraints` in server/modules/catalog-publication/import/vendorAdapter.ts) allows only",
    "`minimum`/`maximum`, so it returns `import-blocked` with `unhandled-constraint:cells,description`.",
    "The manifest records the exact required transformation: fold `cells` into array cardinality bounds and",
    "`description` into the schema description, preserving both. `cells` and `description` are NOT deleted",
    "from the source and the importer is not modified by this deliverable.",
    "",
    "## Recon discrepancy: dangling overlay targets",
    "",
    measured.statement,
    "",
    table(
      ["Measured per board", "Value"],
      [
        ["Distinct unresolved &label overlay targets", measured.measured.distinctUnresolvedOverlayTargetsPerBoard],
        ["Missing &name references", measured.measured.missingReferencedLabelsPerBoard],
      ],
    ),
    "",
    "## Regenerate and verify",
    "",
    "```bash",
    "npm run seed:reconcile        # rewrite src/config/seed-reconciliation/manifest.json + this report",
    "npm run seed:reconcile:check  # fail (non-zero) when the checked-in artifacts have drifted",
    "npx vitest run --config vitest.scripts.config.ts scripts/seed-reconciliation-manifest.test.ts",
    "```",
    "",
    "## Conservation checks",
    "",
    table(
      ["Check", "Value"],
      Object.entries(manifest.conservation).map(([key, value]) => [key, String(value)]),
    ),
    "",
  ].join("\n");
};

export type SeedReconciliationCheckResult = {
  readonly ok: boolean;
  readonly drifts: readonly string[];
};

/**
 * Verify the checked-in artifacts are current and complete. `rootDir` is the source tree used to
 * rebuild the artifacts; `manifestPath` / `reportPath` are the checked-in artifacts to compare.
 */
export const checkSeedReconciliation = (options: {
  readonly rootDir?: string;
  readonly manifestPath?: string;
  readonly reportPath?: string;
} = {}): SeedReconciliationCheckResult => {
  const rootDir = options.rootDir ?? process.cwd();
  const manifestPath = options.manifestPath ?? path.join(rootDir, SEED_RECONCILIATION_MANIFEST_PATH);
  const reportPath = options.reportPath ?? path.join(rootDir, SEED_RECONCILIATION_REPORT_PATH);
  const { manifest, report } = buildSeedReconciliation(rootDir);
  const expectedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  const drifts: string[] = [];

  const readCheckedIn = (target: string, label: string): string | null => {
    try {
      return readFileSync(target, "utf8");
    } catch {
      drifts.push(`${label} is missing at ${target}; run npm run seed:reconcile`);
      return null;
    }
  };

  const actualManifest = readCheckedIn(manifestPath, "manifest");
  if (actualManifest !== null && actualManifest !== expectedManifest) {
    drifts.push(`${manifestPath} is out of date with the seed/catalog inputs; run npm run seed:reconcile`);
  }
  const actualReport = readCheckedIn(reportPath, "report");
  if (actualReport !== null && actualReport !== report) {
    drifts.push(`${reportPath} is out of date with the manifest; run npm run seed:reconcile`);
  }

  for (const [key, value] of Object.entries(manifest.conservation)) {
    if (typeof value === "boolean" && !value) {
      drifts.push(`completeness check failed: ${key}`);
    }
  }
  const conservationNumber = (key: string, fallback: number): number => {
    const value = manifest.conservation[key];
    return typeof value === "number" ? value : fallback;
  };
  const expectedCounts: readonly (readonly [string, number, number])[] = [
    ["totalInputs", conservationNumber("inputsExpected", 125), manifest.summary.totalInputs as number],
    ["vendorInputs", conservationNumber("vendorInputsExpected", 113), manifest.summary.vendorInputs as number],
    [
      "compatibilityInputs",
      conservationNumber("compatibilityInputsExpected", 12),
      manifest.summary.compatibilityInputs as number,
    ],
    ["currentInputs", conservationNumber("currentInputsExpected", 117), manifest.summary.currentInputs as number],
    ["deferredInputs", conservationNumber("deferredInputsExpected", 8), manifest.summary.deferredInputs as number],
  ];
  for (const [label, expected, actual] of expectedCounts) {
    if (expected !== actual) drifts.push(`expected count mismatch: ${label} expected ${expected} measured ${actual}`);
  }

  return { ok: drifts.length === 0, drifts };
};

export const renderSanitizedSummary = (manifest: SeedReconciliationManifest): string => {
  const summary = manifest.summary;
  return [
    "seed-reconciliation summary",
    `  inputs: total=${summary.totalInputs} vendor=${summary.vendorInputs} compatibility=${summary.compatibilityInputs}`,
    `  scope: current=${summary.currentInputs} deferred=${summary.deferredInputs} (${DEFERRED_TRACKER_ID})`,
    `  vendor: files=${manifest.vendorSelection.inputFiles} raw=${summary.vendorRawPropertyEntries} canonical=${summary.vendorInputs} structural-excluded=${summary.vendorStructuralExcluded} hash-pinned=${manifest.vendorSelection.hashPinned}`,
    `  boards: files=${summary.boardFiles} nodes/project=${summary.boardNodesPerProject} business/project=${summary.boardBusinessOccurrencesPerProject} structural/project=${summary.boardStructuralOccurrencesPerProject} phandle/project=${summary.boardPhandleRefsPerProject}`,
    `  blockers: ${summary.knownBlockers} (gpio_int constraints recorded as required transform)`,
    `  planned bindings: ${(manifest.plannedInventory.threeProjects as Record<string, number>).bindings} across three projects (PLANNED, not runtime)`,
    `  disposition counts: ${JSON.stringify(manifest.dispositionCounts)}`,
  ].join("\n");
};
