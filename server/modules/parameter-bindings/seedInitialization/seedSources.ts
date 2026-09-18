import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SeedProjectSources } from "./materialize";

const SEED_PROJECTS = ["atlas", "aurora", "nebula"] as const;

export async function reviewedSeedProjectSources(
  root = process.cwd(),
  options: { readonly json?: boolean; readonly board?: boolean } = {},
): Promise<SeedProjectSources[]> {
  const includeJson = options.json !== false;
  const useBoard = options.board === true;
  const out: SeedProjectSources[] = [];
  for (const projectId of SEED_PROJECTS) {
    const dir = path.join(root, "src/config/seed-sources", projectId);
    const base = useBoard
      ? {
          name: "board.dts" as const,
          format: "dts" as const,
          content: await readFile(path.join(root, "src/config/dts-seed", `${projectId}-board.dts`), "utf8"),
        }
      : {
          name: "vendor-drivers.dts" as const,
          format: "dts" as const,
          content: await readFile(path.join(dir, "vendor-drivers.dts"), "utf8"),
        };
    const files: SeedProjectSources["files"][number][] = [
      base,
      {
        name: "charging-thermal.dts",
        format: "dts",
        content: await readFile(path.join(dir, "charging-thermal.dts"), "utf8"),
      },
    ];
    if (includeJson) {
      files.push({
        name: "power-config.json",
        format: "json",
        content: await readFile(path.join(dir, "power-config.json"), "utf8"),
      });
    }
    out.push({ projectId, files });
  }
  return out;
}
