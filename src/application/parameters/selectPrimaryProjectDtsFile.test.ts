import { describe, expect, it } from "vitest";

import type { ProjectParameterFile } from "@/application/ports/ParameterFileRepository";

import { selectPrimaryProjectDtsFile } from "./selectPrimaryProjectDtsFile";

function file(
  overrides: Partial<ProjectParameterFile> & Pick<ProjectParameterFile, "fileName">
): ProjectParameterFile {
  return {
    id: overrides.id ?? `file-${overrides.fileName}`,
    projectId: overrides.projectId ?? "aurora",
    fileName: overrides.fileName,
    format: overrides.format ?? "dts",
    enabled: overrides.enabled ?? true,
    updatedAt: overrides.updatedAt ?? "2026-07-24T00:00:00.000Z",
    ...overrides
  };
}

describe("selectPrimaryProjectDtsFile", () => {
  it("prefers the project board DTS when multiple enabled DTS files exist", () => {
    const board = file({ id: "board", fileName: "aurora-board.dts" });
    const overlay = file({ id: "overlay", fileName: "aurora-overlay.dts" });

    expect(selectPrimaryProjectDtsFile("aurora", [overlay, board])).toBe(board);
  });

  it("returns the sole enabled DTS file when no board name matches", () => {
    const onlyDts = file({ id: "only", fileName: "custom-board.dts" });

    expect(selectPrimaryProjectDtsFile("aurora", [onlyDts])).toBe(onlyDts);
  });

  it("returns null when no enabled DTS files exist", () => {
    expect(
      selectPrimaryProjectDtsFile("aurora", [
        file({ fileName: "aurora-board.dts", enabled: false }),
        file({ fileName: "settings.json", format: "json" })
      ])
    ).toBeNull();
  });

  it("returns null when multiple enabled DTS files exist without a board match", () => {
    expect(
      selectPrimaryProjectDtsFile("aurora", [
        file({ id: "a", fileName: "fragment-a.dts" }),
        file({ id: "b", fileName: "fragment-b.dts" })
      ])
    ).toBeNull();
  });

  it("ignores disabled or non-DTS files when counting candidates", () => {
    const enabledDts = file({ id: "enabled", fileName: "custom-board.dts" });

    expect(
      selectPrimaryProjectDtsFile("aurora", [
        enabledDts,
        file({ fileName: "aurora-board.dts", enabled: false }),
        file({ fileName: "config.json", format: "json" })
      ])
    ).toBe(enabledDts);
  });
});
