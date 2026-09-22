import { describe, expect, it } from "vitest";

import type { ProjectParameterFile } from "@/application/ports/ParameterFileRepository";

import { selectPrimaryProjectJsonFile } from "./selectPrimaryProjectJsonFile";

function file(
  overrides: Partial<ProjectParameterFile> & Pick<ProjectParameterFile, "fileName">
): ProjectParameterFile {
  return {
    id: overrides.id ?? `file-${overrides.fileName}`,
    projectId: overrides.projectId ?? "aurora",
    fileName: overrides.fileName,
    format: overrides.format ?? "json",
    enabled: overrides.enabled ?? true,
    updatedAt: overrides.updatedAt ?? "2026-07-24T00:00:00.000Z",
    ...overrides
  };
}

describe("selectPrimaryProjectJsonFile", () => {
  it("prefers the project named json when multiple enabled json files exist", () => {
    const config = file({ id: "config", fileName: "aurora.json" });
    const other = file({ id: "other", fileName: "power-config.json" });

    expect(selectPrimaryProjectJsonFile("aurora", [other, config])).toBe(config);
  });

  it("returns the first enabled JSON file when no exact project name matches", () => {
    const power = file({ id: "power", fileName: "power-config.json" });

    expect(selectPrimaryProjectJsonFile("aurora", [power])).toBe(power);
  });

  it("returns null when no enabled JSON files exist", () => {
    expect(
      selectPrimaryProjectJsonFile("aurora", [
        file({ fileName: "power-config.json", enabled: false }),
        file({ fileName: "board.dts", format: "dts" })
      ])
    ).toBeNull();
  });
});
