import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadCommittedDtsSeedFiles } from "../../../scripts/compile-dts-seed";
import { assertCommittedDtsSeedParses } from "../../../scripts/seed-m1-parameters";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("seed M1 DTS integrity", () => {
  it("parses all committed project-primary board artifacts without dtc", async () => {
    const projectFiles = await loadCommittedDtsSeedFiles(root);
    expect(projectFiles).toHaveLength(3);
    expect(() => assertCommittedDtsSeedParses(projectFiles)).not.toThrow();
  });

  it("rejects invalid committed board source", () => {
    expect(() =>
      assertCommittedDtsSeedParses([
        {
          projectId: "aurora",
          fileName: "aurora-board.dts",
          artifactFileName: "aurora-board.dts",
          source: "/dts-v1/;\n/ {\n\tbroken = <"
        }
      ])
    ).toThrow(/failed to parse for aurora/);
  });
});
