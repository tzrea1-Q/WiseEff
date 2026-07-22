/**
 * Merge a label stub tree with a `/plugin/` overlay into one self-contained
 * project-primary DTS (base labels + `&fragment` overrides in a single file).
 */
export function stripDtsPreamble(source: string): string {
  return source
    .replace(/^\/dts-v1\/;\s*\n?/gm, "")
    .replace(/^\/plugin\/;\s*\n?/gm, "")
    .trim();
}

export function mergePrimaryDtsBoard(baseSource: string, overlaySource: string): string {
  const baseBody = stripDtsPreamble(baseSource);
  const overlayBody = stripDtsPreamble(overlaySource);
  return `/dts-v1/;\n\n${baseBody}\n\n${overlayBody}\n`;
}

export function primaryBoardFileName(projectId: string): string {
  return `${projectId}-board.dts`;
}
