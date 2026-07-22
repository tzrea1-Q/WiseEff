export type BindingComparePeer = {
  projectId: string;
  projectName: string;
  rawValue: string;
  moduleName?: string | null;
  driverModule?: string | null;
};

export type BindingComparisonRow = {
  projectId: string;
  projectName: string;
  rawValue: string;
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
  baseProjectId: string;
  baseProjectName: string;
  baseRawValue: string;
  peers: readonly BindingComparePeer[];
  targetProjectId: string | null;
};

/**
 * Dedupe peers by projectId. When multiple bindings collide, keep the first after
 * stable sort by projectName, then rawValue (design lock — do not merge differing values).
 */
export function dedupeBindingComparePeers(
  peers: readonly BindingComparePeer[]
): BindingComparePeer[] {
  const sorted = [...peers].sort((left, right) => {
    const byName = left.projectName.localeCompare(right.projectName, "zh-Hans-CN");
    if (byName !== 0) return byName;
    return left.rawValue.localeCompare(right.rawValue);
  });
  const seen = new Set<string>();
  const unique: BindingComparePeer[] = [];
  for (const peer of sorted) {
    if (seen.has(peer.projectId)) continue;
    seen.add(peer.projectId);
    unique.push(peer);
  }
  return unique;
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
  const peers = dedupeBindingComparePeers(input.peers).map((peer) => ({
    projectId: peer.projectId,
    projectName: peer.projectName,
    rawValue: peer.rawValue,
    moduleName: peer.moduleName,
    driverModule: peer.driverModule,
    isBase: false,
    isTarget: peer.projectId === input.targetProjectId
  }));

  const baseRow: BindingComparisonRow = {
    projectId: input.baseProjectId,
    projectName: input.baseProjectName,
    rawValue: input.baseRawValue,
    isBase: true,
    isTarget: false
  };

  const targetRow = peers.find((peer) => peer.projectId === input.targetProjectId) ?? null;
  const rows = [baseRow, ...peers.map((peer) => ({
    ...peer,
    isTarget: peer.projectId === input.targetProjectId
  }))];

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
  return dedupeBindingComparePeers(peers)[0]?.projectId ?? null;
}

export type BindingCompareOverviewProject = {
  projectId: string;
  projectName: string;
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

/** Compact same/different/missing grouping relative to the base raw value. */
export function buildBindingCompareOverview(
  rows: readonly BindingComparisonRow[],
  baseRawValue: string
): BindingCompareOverview {
  const same: BindingCompareOverviewProject[] = [];
  const changed: BindingCompareOverviewProject[] = [];
  const missing: BindingCompareOverviewProject[] = [];

  for (const row of rows) {
    if (row.isBase) {
      continue;
    }
    const project: BindingCompareOverviewProject = {
      projectId: row.projectId,
      projectName: row.projectName,
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
  if (same.length > 0) {
    groups.push({ kind: "same", label: "相同", projects: same });
  }
  if (changed.length > 0) {
    groups.push({ kind: "changed", label: "不同", projects: changed });
  }
  if (missing.length > 0) {
    groups.push({ kind: "missing", label: "未配置", projects: missing });
  }

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
