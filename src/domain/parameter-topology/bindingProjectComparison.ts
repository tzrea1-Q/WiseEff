export type BindingComparePeer = {
  /** Canonical binding instance identity. */
  bindingId?: string;
  projectId: string;
  projectName: string;
  rawValue: string;
  sourceIdentity?: string | null;
  sourceOccurrenceId?: string | null;
  sourceRef?: string | null;
  sourceLocator?: string | Record<string, unknown> | null;
  displayLocator?: string | null;
  fileName?: string | null;
  configSetId?: string | null;
  locator?: string | null;
  currentValueId?: string | null;
  /** Definition revision pinned by the value itself. */
  definitionRevisionId?: string | null;
  /** Revision selected as effective for this binding instance. */
  effectiveRevisionId?: string | null;
  moduleName?: string | null;
  driverModule?: string | null;
};

export type BindingComparisonRow = {
  bindingId?: string;
  comparisonKey: string;
  projectId: string;
  projectName: string;
  rawValue: string;
  sourceIdentity?: string | null;
  sourceOccurrenceId?: string | null;
  sourceRef?: string | null;
  sourceLocator?: string | Record<string, unknown> | null;
  displayLocator?: string | null;
  fileName?: string | null;
  configSetId?: string | null;
  locator?: string | null;
  currentValueId?: string | null;
  definitionRevisionId?: string | null;
  effectiveRevisionId?: string | null;
  moduleName?: string | null;
  driverModule?: string | null;
  isBase: boolean;
  isTarget: boolean;
};

export type BindingCompareDelta =
  | { kind: "same"; label: "值相同" }
  | { kind: "changed"; label: "值不同" }
  | { kind: "missing"; label: "目标项目尚未配置该参数" };

export type BindingProjectComparison = {
  rows: BindingComparisonRow[];
  baseRow: BindingComparisonRow;
  targetRow: BindingComparisonRow | null;
  peers: BindingComparisonRow[];
  delta: BindingCompareDelta;
  coverage: { configured: number; total: number };
};

export type BuildBindingProjectComparisonInput = {
  baseBindingId?: string;
  baseProjectId: string;
  baseProjectName: string;
  baseRawValue: string;
  peers: readonly BindingComparePeer[];
  /** Canonical target binding instance; preferred when a project has siblings. */
  targetBindingId?: string | null;
  /** Compatibility selector for callers with one peer per project. */
  targetProjectId?: string | null;
};

function comparePeer(left: BindingComparePeer, right: BindingComparePeer): number {
  const byName = left.projectName.localeCompare(right.projectName, "zh-Hans-CN");
  if (byName !== 0) return byName;
  const leftIdentity = bindingComparePeerDisplayIdentity(left) ?? left.bindingId ?? left.currentValueId ?? "";
  const rightIdentity = bindingComparePeerDisplayIdentity(right) ?? right.bindingId ?? right.currentValueId ?? "";
  const byIdentity = leftIdentity.localeCompare(rightIdentity);
  if (byIdentity !== 0) return byIdentity;
  return left.rawValue.localeCompare(right.rawValue);
}

/**
 * Keep every canonical binding instance. The historic export name remains for
 * compatibility with the workbench, but projectId is never a dedupe key.
 */
export function dedupeBindingComparePeers(
  peers: readonly BindingComparePeer[]
): BindingComparePeer[] {
  return [...peers].sort(comparePeer);
}

export function bindingComparePeerKey(peer: BindingComparePeer): string {
  if (peer.bindingId) return peer.bindingId;
  const instanceIdentity = bindingComparePeerDisplayIdentity(peer);
  return instanceIdentity ? `${peer.projectId}:${instanceIdentity}` : peer.projectId;
}

function sourceLocatorLabel(sourceLocator: BindingComparePeer["sourceLocator"]): string | null {
  if (!sourceLocator) return null;
  if (typeof sourceLocator === "string") return sourceLocator.trim() || null;
  for (const key of ["path", "nodePath", "propertyPath", "locator", "filePath"]) {
    const value = sourceLocator[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const startLine = sourceLocator.startLine;
  const startColumn = sourceLocator.startColumn;
  const endLine = sourceLocator.endLine;
  const endColumn = sourceLocator.endColumn;
  if (
    typeof startLine === "number" &&
    typeof startColumn === "number" &&
    typeof endLine === "number" &&
    typeof endColumn === "number"
  ) {
    return `行 ${startLine}:${startColumn}–${endLine}:${endColumn}`;
  }
  return null;
}

export function bindingComparePeerDisplayIdentity(peer: BindingComparePeer): string | null {
  return peer.displayLocator ??
    peer.locator ??
    peer.sourceRef ??
    sourceLocatorLabel(peer.sourceLocator) ??
    peer.sourceIdentity ??
    peer.sourceOccurrenceId ??
    peer.currentValueId ??
    null;
}

export function bindingComparePeerDisplayLabel(peer: BindingComparePeer): string | null {
  return bindingComparePeerDisplayIdentity(peer) ?? peer.fileName ?? peer.configSetId ?? null;
}

function buildDelta(baseRawValue: string, target: BindingComparisonRow | null): BindingCompareDelta {
  if (!target) {
    return { kind: "missing", label: "目标项目尚未配置该参数" };
  }
  if (baseRawValue === target.rawValue) {
    return { kind: "same", label: "值相同" };
  }
  return { kind: "changed", label: "值不同" };
}

export function buildBindingProjectComparison(
  input: BuildBindingProjectComparisonInput
): BindingProjectComparison {
  const sortedPeers = dedupeBindingComparePeers(input.peers);
  const peersByKey = new Map<string, BindingComparePeer>();
  const uniquePeers: BindingComparePeer[] = [];
  for (const peer of sortedPeers) {
    const comparisonKey = bindingComparePeerKey(peer);
    const previous = peersByKey.get(comparisonKey);
    if (previous) {
      const sameInstance =
        previous.projectId === peer.projectId &&
        previous.projectName === peer.projectName &&
        previous.rawValue === peer.rawValue &&
        previous.sourceIdentity === peer.sourceIdentity &&
        previous.sourceOccurrenceId === peer.sourceOccurrenceId &&
        previous.sourceRef === peer.sourceRef &&
        previous.sourceLocator === peer.sourceLocator &&
        previous.displayLocator === peer.displayLocator &&
        previous.fileName === peer.fileName &&
        previous.configSetId === peer.configSetId &&
        previous.locator === peer.locator &&
        previous.currentValueId === peer.currentValueId &&
        previous.definitionRevisionId === peer.definitionRevisionId &&
        previous.effectiveRevisionId === peer.effectiveRevisionId;
      if (sameInstance) continue;
      throw new Error(`duplicate canonical binding comparison identity: ${comparisonKey}`);
    }
    peersByKey.set(comparisonKey, peer);
    uniquePeers.push(peer);
  }
  const projectPeerCounts = new Map<string, number>();
  for (const peer of uniquePeers) {
    projectPeerCounts.set(peer.projectId, (projectPeerCounts.get(peer.projectId) ?? 0) + 1);
  }
  const peers = uniquePeers.map((peer) => {
    const comparisonKey = bindingComparePeerKey(peer);
    const isTarget = input.targetBindingId != null
      ? comparisonKey === input.targetBindingId
      : input.targetProjectId != null &&
        projectPeerCounts.get(input.targetProjectId) === 1 &&
        peer.projectId === input.targetProjectId;
    return {
      bindingId: peer.bindingId,
      comparisonKey,
      projectId: peer.projectId,
      projectName: peer.projectName,
      rawValue: peer.rawValue,
      sourceIdentity: peer.sourceIdentity,
      sourceOccurrenceId: peer.sourceOccurrenceId,
      sourceRef: peer.sourceRef,
      sourceLocator: peer.sourceLocator,
      displayLocator: peer.displayLocator,
      fileName: peer.fileName,
      configSetId: peer.configSetId,
      locator: peer.locator,
      currentValueId: peer.currentValueId,
      definitionRevisionId: peer.definitionRevisionId,
      effectiveRevisionId: peer.effectiveRevisionId,
      moduleName: peer.moduleName,
      driverModule: peer.driverModule,
      isBase: false,
      isTarget
    };
  });

  const baseRow: BindingComparisonRow = {
    bindingId: input.baseBindingId,
    comparisonKey: input.baseBindingId ?? `base:${input.baseProjectId}`,
    projectId: input.baseProjectId,
    projectName: input.baseProjectName,
    rawValue: input.baseRawValue,
    isBase: true,
    isTarget: false
  };

  const targetRow = peers.find((peer) => peer.isTarget) ?? null;
  const rows = [baseRow, ...peers];

  return {
    rows,
    baseRow,
    targetRow,
    peers,
    delta: buildDelta(input.baseRawValue, targetRow),
    coverage: {
      configured: rows.length,
      total: rows.length
    }
  };
}

export function defaultBindingCompareTargetId(
  peers: readonly BindingComparePeer[]
): string | null {
  const sorted = dedupeBindingComparePeers(peers);
  const first = sorted[0];
  if (!first) return null;
  if (sorted.length > 1) return null;
  return bindingComparePeerKey(first);
}

export type BindingCompareOverviewProject = {
  bindingId?: string;
  comparisonKey?: string;
  projectId: string;
  projectName: string;
  displayLabel?: string;
  isBase: boolean;
  isTarget: boolean;
};

export type BindingCompareOverviewGroupKind = "same" | "changed" | "missing";

export type BindingCompareOverviewGroup = {
  kind: BindingCompareOverviewGroupKind;
  label: string;
  projects: BindingCompareOverviewProject[];
};

export type BindingCompareOverview = {
  summary: string;
  groups: BindingCompareOverviewGroup[];
};

function peerDisplayLabel(row: BindingComparisonRow): string {
  const identity = bindingComparePeerDisplayLabel(row);
  return identity ? `${row.projectName} · ${identity}` : row.projectName;
}

/** Compact same/different/missing grouping relative to the base raw value. */
export function buildBindingCompareOverview(
  rows: readonly BindingComparisonRow[],
  baseRawValue: string
): BindingCompareOverview {
  const same: BindingCompareOverviewProject[] = [];
  const changed: BindingCompareOverviewProject[] = [];
  const missing: BindingCompareOverviewProject[] = [];

  for (const row of rows) {
    if (row.isBase) continue;
    const project: BindingCompareOverviewProject = {
      bindingId: row.bindingId,
      comparisonKey: row.comparisonKey,
      projectId: row.projectId,
      projectName: row.projectName,
      displayLabel: peerDisplayLabel(row),
      isBase: row.isBase,
      isTarget: row.isTarget
    };
    if (row.rawValue.trim() === "") {
      missing.push(project);
    } else if (row.rawValue === baseRawValue) {
      same.push(project);
    } else {
      changed.push(project);
    }
  }

  const groups: BindingCompareOverviewGroup[] = [];
  if (same.length > 0) groups.push({ kind: "same", label: "相同", projects: same });
  if (changed.length > 0) groups.push({ kind: "changed", label: "不同", projects: changed });
  if (missing.length > 0) groups.push({ kind: "missing", label: "未配置", projects: missing });

  const peerCount = same.length + changed.length + missing.length;
  let summary: string;
  if (peerCount === 0) {
    summary = "暂无其他项目";
  } else if (same.length > 0 && changed.length === 0 && missing.length === 0) {
    summary = "全部相同";
  } else {
    const parts: string[] = [];
    if (same.length > 0) parts.push(`${same.length} 相同`);
    if (changed.length > 0) parts.push(`${changed.length} 不同`);
    if (missing.length > 0) parts.push(`${missing.length} 未配置`);
    summary = parts.join(" · ");
  }

  return { summary, groups };
}
