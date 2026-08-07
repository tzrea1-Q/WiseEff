/** Critical DTS node paths that require elevated edit capability. */
export function isCriticalDtsNodePath(nodePath: string): boolean {
  const lower = nodePath.toLocaleLowerCase();
  return lower.includes("regulator") || lower.includes("thermal");
}
