import type { ProjectParameterFile } from "@/application/ports/ParameterFileRepository";

export function selectPrimaryProjectDtsFile(
  projectId: string,
  files: ProjectParameterFile[]
): ProjectParameterFile | null {
  const enabledDtsFiles = files.filter((file) => file.enabled && file.format === "dts");

  const boardMatch = enabledDtsFiles.find(
    (file) => file.fileName === `${projectId}-board.dts`
  );
  if (boardMatch) {
    return boardMatch;
  }

  if (enabledDtsFiles.length === 1) {
    return enabledDtsFiles[0];
  }

  return null;
}
