/**
 * Cross-surface registry of unsaved parameter work on /parameters: the
 * workspace's pending draft round and the workbench's local (unvalidated)
 * draft bag report here, so the top-bar project switcher and the
 * beforeunload guard can warn before the work is dropped.
 */
const unsavedCounts = new Map<string, number>();

export function reportUnsavedParameterWork(sourceKey: string, count: number): void {
  if (count > 0) {
    unsavedCounts.set(sourceKey, count);
  } else {
    unsavedCounts.delete(sourceKey);
  }
}

export function clearUnsavedParameterWork(sourceKey: string): void {
  unsavedCounts.delete(sourceKey);
}

export function unsavedParameterWorkCount(): number {
  let total = 0;
  for (const count of unsavedCounts.values()) {
    total += count;
  }
  return total;
}

/** Test seam — reset the registry between test cases. */
export function resetUnsavedParameterWork(): void {
  unsavedCounts.clear();
}
