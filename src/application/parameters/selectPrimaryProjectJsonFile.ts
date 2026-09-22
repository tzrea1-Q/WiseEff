import type { ProjectParameterFile } from "@/application/ports/ParameterFileRepository";

export function selectPrimaryProjectJsonFile(
  projectId: string,
  files: ProjectParameterFile[]
): ProjectParameterFile | null {
  const enabledJsonFiles = files.filter(
    (file) => file.enabled && (file.format === "json" || file.fileName.endsWith(".json"))
  );

  const exactProjectMatch = enabledJsonFiles.find(
    (file) =>
      file.fileName === `${projectId}.json` ||
      file.fileName === `${projectId}-config.json` ||
      file.fileName === `${projectId}-board.json`
  );
  if (exactProjectMatch) {
    return exactProjectMatch;
  }

  if (enabledJsonFiles.length >= 1) {
    return enabledJsonFiles[0];
  }

  return null;
}
