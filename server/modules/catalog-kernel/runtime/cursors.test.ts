import { describe, expect, it } from "vitest";

import { CatalogCursor } from "../../parameter-catalog-contract/index";
import {
  compareOrderTuples,
  decodeCatalogCursor,
  encodeCatalogCursor,
  fingerprintCatalogQuery,
} from "./cursors";

describe("catalog snapshot cursors", () => {
  it("round-trips a release-bound cursor", () => {
    const encoded = encodeCatalogCursor({
      releaseId: "crel_acme_2",
      digest: "sha256:abc",
      queryFingerprint: "sha256:def",
      last: ["driver", "acme,power", "csub_acme_power"],
    });
    const decoded = decodeCatalogCursor(encoded);
    expect(decoded).toEqual({
      releaseId: "crel_acme_2",
      digest: "sha256:abc",
      queryFingerprint: "sha256:def",
      last: ["driver", "acme,power", "csub_acme_power"],
    });
    expect(CatalogCursor(encoded)).toBe(encoded);
  });

  it("rejects a malformed cursor instead of throwing", () => {
    expect(decodeCatalogCursor("%%%not-base64%%%")).toEqual({ malformed: true });
    expect(decodeCatalogCursor("e30")).toEqual({ malformed: true });
  });

  it("fingerprints queries so a filter change cannot reuse a page cursor", () => {
    const all = fingerprintCatalogQuery({ propertyKey: { kind: "absent" } });
    const filtered = fingerprintCatalogQuery({
      propertyKey: { kind: "present", value: "iin_max" },
    });
    expect(all).not.toBe(filtered);
  });

  it("orders tuples lexicographically", () => {
    expect(compareOrderTuples(["a", 1], ["a", 2])).toBeLessThan(0);
    expect(compareOrderTuples(["b"], ["a"])).toBeGreaterThan(0);
  });
});
