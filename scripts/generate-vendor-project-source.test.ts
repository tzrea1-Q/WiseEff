import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
    expect(generated.emitted).toBe(113);
    expect(generated.skipped).toEqual([]);
    // 27 driver subjects + 12 node-type subjects, one DTS node each.
    expect(generated.driverSubjects + generated.nodeTypeSubjects).toBe(39);
  });

  it("is deterministic for the same reviewed input", () => {
    const first = generateVendorProjectSource(manifest, root);
    const second = generateVendorProjectSource(manifest, root);
    expect(second.text).toBe(first.text);
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
