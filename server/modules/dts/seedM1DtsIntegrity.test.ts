import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadCommittedDtsSeedFiles } from "../../../scripts/compile-dts-seed";
import { assertCommittedDtsSeedParses } from "../../../scripts/seed-m1-parameters";
import { generateDtsPowerSeedArtifacts } from "../../../scripts/dts-power-seed";

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

  it("rejects syntactically valid seed boards with undefined references", async () => {
    const [file] = await loadCommittedDtsSeedFiles(root);
    expect(() => assertCommittedDtsSeedParses([{ ...file,
      source: "/dts-v1/; / { consumer { gpios = <&undefined_gpio 1 0>; }; };"
    }])).toThrow("Undefined DTS labels: undefined_gpio");
  });

  it("ignores reference-like text and fake definitions in comments and strings", async () => {
    const [file] = await loadCommittedDtsSeedFiles(root);
    expect(() => assertCommittedDtsSeedParses([{ ...file,
      source: '/dts-v1/; /* &example */ / { note = "&example missing:"; };'
    }])).not.toThrow();
    expect(() => assertCommittedDtsSeedParses([{ ...file,
      source: '/dts-v1/; /* missing: */ / { note = "missing:"; consumer { gpios = <&missing 1 0>; }; };'
    }])).toThrow("Undefined DTS labels: missing");
  });

  it("regenerates complete project variants from the authored board without a synthetic fixture", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "wiseeff-complete-seed-"));
    try {
      const seedDir = join(temporaryRoot, "src/config/dts-seed");
      await mkdir(seedDir, { recursive: true });
      const source = await readFile(join(root, "src/config/dts-seed/aurora-board.dts"), "utf8");
      await writeFile(join(seedDir, "aurora-board.dts"), source);
      const seed = await generateDtsPowerSeedArtifacts(temporaryRoot);
      expect(seed.projectFiles).toHaveLength(3);
      expect(() => assertCommittedDtsSeedParses(seed.projectFiles)).not.toThrow();
      expect(seed.projectFiles.find(file => file.projectId === "aurora")?.source).toBe(source);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
