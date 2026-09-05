import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "productionWire.ts"), "utf8");

describe("production Catalog composition import ratchet", () => {
  it("does not import fake-empty projections into the real pool branch", () => {
    expect(source).not.toContain("unregisteredProjection");
    expect(source).not.toContain("zeroUsageProjection");
    expect(source).not.toContain("emptyGovernanceQueryPorts");
    expect(source).toContain("createRegistrationProjectionFromQueries");
    expect(source).toContain("createUsageProjectionFromQueries");
    expect(source).toContain("bindGovernanceCatalogQueryPorts");
    expect(source).toContain("unavailableRegistrationProjection");
    expect(source).toContain("unavailableUsageProjection");
    expect(source).toContain("unavailableGovernanceQueryPorts");
    expect(source).toContain("resolveCatalogReleasePin");
  });
});
