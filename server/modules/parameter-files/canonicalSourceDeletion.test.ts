import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../shared/database/client";
import { parseDts } from "../dts";
import { validatePinnedDtsSourceDeletion, type CanonicalSourceManifest } from "./canonicalSource";

const before = '/dts-v1/; / { charger { compatible = "acme,power"; iin_max = <1000>; }; other { keep = <1>; }; };';
const node = parseDts(before).topLevel[0]!.children.find((child) => child.kind === "node" && child.name === "charger")!;
if (node.kind !== "node") throw new Error("Missing test node");
const property = node.children.find((child) => child.kind === "property" && child.name === "iin_max")!;
if (property.kind !== "property") throw new Error("Missing test property");
// Only the provenance lookup is stubbed; both source documents use the real parser.
const db: Queryable = { query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{
  start_offset: property.span.start, end_offset: property.span.end, raw_text: property.rawText,
  property_name: property.name, node_locator: "/charger", compatible: "acme,power",
}] }) };
const manifest = { configRevisionId: "revision", fileVersionId: "version", logicalNodeId: "charger",
  locator: { kind: "dts-property", propertyOccurrenceId: "property", nodeOccurrenceId: "node", propertyName: "iin_max" },
} as CanonicalSourceManifest;
const after = before.replace("iin_max = <1000>;", "/delete-property/ iin_max;");

describe("exact DTS deletion source proof", () => {
  it("rejects a changed non-target property even with one matching delete directive", async () => {
    await expect(validatePinnedDtsSourceDeletion(db, manifest, before, after.replace("keep = <1>", "keep = <2>")))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("preserves an unrelated node's existing same-named delete directive", async () => {
    const oldSource = before.replace("keep = <1>;", "keep = <1>; /delete-property/ iin_max;");
    const newSource = after.replace("keep = <1>;", "keep = <1>; /delete-property/ iin_max;");
    await expect(validatePinnedDtsSourceDeletion(db, manifest, oldSource, newSource)).resolves.toBeUndefined();
  });
});
