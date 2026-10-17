import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { parseDts, resolveDts } from "../server/modules/dts";
import { resolveDtsConfigSet } from "../server/modules/dts/configSetResolver";
import { missingReferencedLabels } from "../server/modules/dts/danglingAnchorStub";
import { isStructuralPropertyKey } from "../src/domain/parameter-topology/parameterSurface";

import {
  SEED_SOURCE_PROJECTS,
  VENDOR_SOURCE_FILE_NAME,
  generateVendorProjectSource,
} from "./generate-vendor-project-source";

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(path.join(root, "src/config/seed-reconciliation/manifest.json"), "utf8"),
);

const vendorInputs = manifest.inputs.filter(
  (entry: { family: string }) => entry.family === "vendor",
);

describe("vendor project source generation", () => {
  it("expresses every reviewed vendor input and skips none", () => {
    const generated = generateVendorProjectSource(manifest, root);
    expect(generated.emitted).toBe(vendorInputs.length);
    expect(generated.emitted).toBe(115);
    expect(generated.skipped).toEqual([]);
    // 27 driver subjects + 13 node-type subjects, one DTS node each.
    expect(generated.driverSubjects + generated.nodeTypeSubjects).toBe(40);
  });

  it("is deterministic for the same reviewed input", () => {
    const first = generateVendorProjectSource(manifest, root);
    const second = generateVendorProjectSource(manifest, root);
    expect(second.text).toBe(first.text);
  });

  it("defines every reference in the generated source without a compile companion", () => {
    const { text } = generateVendorProjectSource(manifest, root);
    expect(missingReferencedLabels(text)).toEqual([]);
    const resolved = resolveDtsConfigSet({
      entryFile: VENDOR_SOURCE_FILE_NAME,
      includeSearchPaths: [],
      overlayOrder: [],
      files: new Map([[VENDOR_SOURCE_FILE_NAME, { fileVersionId: "vendor-complete-source", content: text }]]),
    });
    expect(resolved.diagnostics).toEqual([]);
    const rootNode = parseDts(text).topLevel[0]!;
    expect(rootNode.children[0]).toMatchObject({ kind: "property", name: "board_id" });
    expect(rootNode.children.some(child => child.kind === "node" && child.name === "/")).toBe(false);
    const nodes = resolveDts(text).nodes;
    for (const label of ["gpio2", "gpio5", "gpio6", "gpio7", "gpio10", "gpio13"]) {
      const provider = nodes.find(node => node.labels.includes(label));
      expect(provider?.properties.find(property => property.name === "gpio-controller")?.valueType, label).toBe("bool");
      expect(provider?.properties.find(property => property.name === "#gpio-cells")?.rawText, label).toBe("<2>");
    }
    const gic = nodes.find(node => node.labels.includes("gic"));
    expect(gic?.properties.find(property => property.name === "interrupt-controller")?.valueType).toBe("bool");
    expect(gic?.properties.find(property => property.name === "#interrupt-cells")?.rawText).toBe("<3>");
  });

  it("preserves all 115 business locators, subjects and reviewed example values", () => {
    const nodes = resolveDts(generateVendorProjectSource(manifest, root).text).nodes;
    const business = nodes.flatMap(node => node.properties
      .filter(property => !isStructuralPropertyKey(property.name))
      .map(property => ({ node, property })));
    expect(business).toHaveLength(115);
    for (const entry of vendorInputs) {
      const driver = entry.formalSubject.kind === "driver";
      const nodePath = driver ? entry.formalSubject.value.replace(/[^A-Za-z0-9]/g, "_")
        : entry.formalSubject.value === "/" ? "" : entry.formalSubject.value;
      const observed = business.find(({ node, property }) => node.nodePath === nodePath && property.name === entry.propertyKey);
      expect(observed, entry.inputId).toBeDefined();
      expect(observed?.node.compatible, entry.inputId).toBe(driver ? entry.formalSubject.value : undefined);
      const yaml = parseYaml(readFileSync(path.join(root, entry.sourcePath), "utf8"));
      const example = yaml.properties[entry.propertyKey].exampleValue;
      expect(observed?.property.rawText, entry.inputId).toBe(example == null ? "" : String(example).replace(/\s+/g, " ").trim());
    }
  });

  it("keeps the committed files identical to the generated text", () => {
    const generated = generateVendorProjectSource(manifest, root);
    for (const project of SEED_SOURCE_PROJECTS) {
      const committed = readFileSync(
        path.join(root, "src/config/seed-sources", project, VENDOR_SOURCE_FILE_NAME),
        "utf8",
      );
      expect(committed, project).toBe(generated.text);
    }
  });

  it("declares a compatible for driver nodes and none for node-type nodes", () => {
    const generated = generateVendorProjectSource(manifest, root);
    const compatibles = [...generated.text.matchAll(/^\t\tcompatible = /gm)].length;
    const nodeTypeMarkers = [
      ...generated.text.matchAll(/^\t\t\/\* node-type identity is the node name/gm),
    ].length;
    expect(compatibles).toBe(generated.driverSubjects);
    expect(nodeTypeMarkers).toBe(generated.nodeTypeSubjects);
  });

  it("uses the reviewed vendor example values rather than invented literals", () => {
    const generated = generateVendorProjectSource(manifest, root);
    // `bytes` examples are `/bits/ 8 <...>` and `mixed` GPIO examples are phandle
    // arrays; both only appear if the vendor metadata was actually read.
    expect(generated.text).toContain("/bits/ 8 <");
    expect(generated.text).toMatch(/= <&gpio/);
    expect(generated.text).not.toContain("demo-a");
    // A `bool` example is empty, which is the DTS presence form.
    expect(generated.text).toMatch(/^\t\t\w+;$/m);
  });
});
