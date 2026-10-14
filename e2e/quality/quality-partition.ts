export const qualityLanes = ["visual", "consistency-1", "consistency-2", "accessibility"] as const;
export type QualityLane = typeof qualityLanes[number];

export function shouldRegisterConsistencyFixture(lane: QualityLane | undefined, index: number): boolean {
  return lane === undefined || lane === (index % 2 === 0 ? "consistency-1" : "consistency-2");
}

export function consistencyTestMatch(lane: QualityLane | undefined): RegExp[] {
  return lane === "consistency-1"
    ? [/consistency\.quality\.spec\.ts/, /styles\.consistency\.collector\.spec\.ts/]
    : [/consistency\.(quality|collector)\.spec\.ts/];
}

export function parseQualityLane(value: string | undefined): QualityLane | undefined {
  if (value === undefined) return undefined;
  const lane = qualityLanes.find((candidate) => candidate === value);
  if (!lane) throw new Error("WISEEFF_QUALITY_LANE must be visual, consistency-1, consistency-2, or accessibility.");
  return lane;
}

export function selectQualityProjects<Project extends { name?: string }>(
  projects: readonly Project[], lane: QualityLane | undefined
): Project[] {
  const knownNames = ["runtime-warmup", "visual", "compact", "consistency", "a11y", "responsive"];
  if (projects.some((project) => !knownNames.includes(project.name ?? ""))) {
    throw new Error("Unknown quality project registration; assign it to a quality lane before running.");
  }
  if (lane === undefined) return [...projects];
  const names = lane === "visual" ? ["visual", "compact"]
    : lane === "accessibility" ? ["a11y", "responsive"] : ["consistency"];
  return projects.filter((project) => project.name === "runtime-warmup" || names.includes(project.name ?? ""));
}
