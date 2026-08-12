import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Search, X } from "lucide-react";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import {
  dtsReloadBlockReasonLabels,
  dtsReloadPurposeLabels,
  dtsReloadStatusLabels,
  dtsReloadVerificationOutcomeLabels,
  DTS_RELOAD_CONFIRMATION_TOKEN,
  isStreamingKernelLogCommand,
  SENSITIVE_RELOAD_CONFIRMATION_TOKEN
} from "@/domain/dtsReload/types";
import type {
  DtsReloadCandidate,
  DtsReloadIntegrityCheck,
  DtsReloadParameterVerification,
  DtsReloadResidue,
  DtsReloadRun,
  DtsReloadRunListItem,
  DtsReloadSnapshot
} from "@/domain/dtsReload/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ColumnFilter } from "@/components/ColumnFilter";
import { ParameterValueDiff } from "@/components/ParameterValueDiff";
import { inferBridgeOnline } from "@/components/bridgeOnline";
import {
  LocalDeviceBridgePanel,
  type LocalDeviceBridgePanelState
} from "@/components/LocalDeviceBridgePanel";
import { DtsTopologyNavigator } from "@/components/parameter-topology/DtsTopologyNavigator";
import {
  DtsReloadCandidateEditDialog,
  hasMeaningfulDebugChange
} from "@/features/dts-reload/DtsReloadCandidateEditDialog";
import type { DtsWorkbenchTreeNode } from "@/application/parameters/buildDtsTopologyTree";
import {
  buildReloadModuleTree,
  collectSubtreeBindingIds
} from "@/application/parameters/buildReloadModuleTree";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import { resolveParameterModuleRegistryRepository } from "@/application/parameters/parameterModuleRegistryResolve";
import {
  EMPTY_PARAMETER_MODULE_REGISTRY,
  type ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";
import type { DeviceBridgeRecord, LocalBridgeHealthState } from "@/infrastructure/http/deviceBridgeClient";
import type { LocalBridgeProbeResult } from "@/infrastructure/http/bridgeConnectLauncher";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { cn } from "@/lib/utils";
import { DEVICE_BRIDGE_RELEASES_PATH } from "@wiseeff/device-command-core/bridgeApiPaths";

type DeployProtocol = "hdc" | "adb";

export type DtsReloadBridgeOption = {
  id: string;
  machineLabel: string;
  lastSeenAt?: string | null;
};

export type DtsReloadReachableTarget = {
  targetRef: string;
  label?: string;
  bridgeId?: string;
};

export type DtsReloadPageProps = {
  projects: Array<{ id: string; name: string }>;
  initialProjectId?: string;
  repository: DtsReloadRepository | null;
  canStartRun: boolean;
  unavailableReason?: string;
  bridges?: DtsReloadBridgeOption[];
  listBridges?: () => Promise<DtsReloadBridgeOption[]>;
  /** Optional local health probe — defaults to deviceBridgeClient.probeLocalBridgeHealth. */
  probeBridgeHealth?: () => Promise<Pick<LocalBridgeHealthState, "connected" | "bridgeId"> | null>;
  /** Optional reachable-target detection (same seam as /node-debugging detectTargets). */
  detectTargets?: (protocol: DeployProtocol) => Promise<DtsReloadReachableTarget[]>;
  /** Test/demo seam: seed deploy target without the removed manual targetRef field. */
  initialTargetRef?: string;
  /** Optional module registry for navigator nesting (defaults to runtime resolve). */
  moduleRegistryRepository?: ParameterModuleRegistryRepository | null;
};

type BridgeOption = DtsReloadBridgeOption;

const BRIDGE_UPGRADE_ENTRY_PATH = "/node-debugging";
const UNCLASSIFIED_MODULE_LABEL = "未分类";

function candidateModuleLabel(candidate: Pick<DtsReloadCandidate, "module">): string {
  return candidate.module.trim() || UNCLASSIFIED_MODULE_LABEL;
}

function findWorkbenchTreeNode(
  nodes: DtsWorkbenchTreeNode[],
  nodeId: string
): DtsWorkbenchTreeNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const nested = findWorkbenchTreeNode(node.children, nodeId);
    if (nested) return nested;
  }
  return null;
}

function asDeviceBridgeRecords(options: DtsReloadBridgeOption[]): DeviceBridgeRecord[] {
  return options.map((item) => ({
    id: item.id,
    machineLabel: item.machineLabel,
    platform: "darwin",
    arch: "arm64",
    clientVersion: null,
    capabilities: {},
    createdAt: "1970-01-01T00:00:00.000Z",
    lastSeenAt: item.lastSeenAt ?? null,
    revokedAt: null
  }));
}

function adaptProbeBridgeHealth(
  probe: () => Promise<Pick<LocalBridgeHealthState, "connected" | "bridgeId"> | null>
): () => Promise<LocalBridgeProbeResult> {
  return async () => {
    const partial = await probe();
    if (!partial) {
      return { health: null, reachability: "offline" };
    }
    return {
      health: {
        ok: true,
        paired: true,
        connected: partial.connected,
        bridgeId: partial.bridgeId,
        updatedAt: new Date().toISOString(),
        tools: {
          adb: { available: true },
          hdc: { available: true }
        }
      },
      reachability: "ok"
    };
  };
}

function readBridgeUpgradeReleasesPath(error: unknown): string | null {
  if (!(error instanceof WiseEffApiError)) return null;
  if (error.details?.code !== "bridge-upgrade-required") return null;
  const path = error.details.releasesPath;
  return typeof path === "string" && path.trim() ? path.trim() : DEVICE_BRIDGE_RELEASES_PATH;
}
const dtsReloadStepLabels: Record<string, string> = {
  "compile-base": "编译基础设备树",
  "compile-overlay": "编译 Overlay",
  "dry-run-merge": "干运行合并",
  "assert-effect": "断言效果",
  "mount-target": "挂载目标",
  "transfer-artifact": "传输产物",
  "trigger-reload": "触发重载"
};

const dtsReloadStepOutcomeLabels: Record<string, string> = {
  passed: "通过",
  failed: "失败",
  skipped: "跳过",
  pending: "等待",
  running: "进行中"
};

function sensitiveBadgeLabel(candidate: DtsReloadCandidate): string | null {
  const match = candidate.sensitiveMatch;
  if (!match) return null;
  return match.riskTier === "critical" ? "敏感 · critical" : "敏感 · high";
}

function parseCellIntegers(raw: string): number[] | null {
  const trimmed = raw.trim();
  const bracket = /^\[([0-9a-fA-F\s]+)\]$/.exec(trimmed);
  if (bracket) {
    const tokens = bracket[1]!.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;
    const values = tokens.map((token) => Number.parseInt(token, 16));
    return values.every((value) => Number.isFinite(value)) ? values : null;
  }
  const groups = trimmed.match(/<[^>]+>/g);
  if (!groups || groups.length === 0) {
    const bare = /^(0x[0-9a-fA-F]+|-?\d+)(?:\s+(0x[0-9a-fA-F]+|-?\d+))*$/.exec(trimmed);
    if (!bare) return null;
    return trimmed.split(/\s+/).map((token) => Number(token));
  }
  const values: number[] = [];
  for (const group of groups) {
    const body = group.slice(1, -1).trim();
    if (!body) return null;
    for (const token of body.split(/\s+/)) {
      if (!/^(0x[0-9a-fA-F]+|-?\d+)$/.test(token)) return null;
      values.push(Number(token));
    }
  }
  return values.every((value) => Number.isFinite(value)) ? values : null;
}

function isPhandleCellFamilyKind(kind: string | null | undefined): boolean {
  return kind === "mixed" || kind === "phandle-list" || kind === "phandle-cells";
}

/** GPIO-style groups: each `<&label N …>` with uniform width (phandle + ≥1 integers). */
function parsePhandleCellGroups(
  raw: string
): Array<{ label: string; integers: number[]; width: number }> | null {
  const trimmed = raw.trim();
  const groups = trimmed.match(/<[^>]+>/g);
  if (!groups || groups.length === 0) return null;
  const parsed: Array<{ label: string; integers: number[]; width: number }> = [];
  for (const group of groups) {
    const tokens = group.slice(1, -1).trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return null;
    const labelMatch = /^&([A-Za-z_][\w]*)$/.exec(tokens[0]!);
    if (!labelMatch) return null;
    const integers: number[] = [];
    for (const token of tokens.slice(1)) {
      if (!/^(0x[0-9a-fA-F]+|-?\d+)$/.test(token)) return null;
      integers.push(Number(token));
    }
    if (integers.length === 0 || integers.some((value) => !Number.isFinite(value))) return null;
    parsed.push({ label: labelMatch[1]!, integers, width: integers.length + 1 });
  }
  const width = parsed[0]!.width;
  if (parsed.some((group) => group.width !== width)) return null;
  return parsed;
}

function countQuotedStrings(raw: string): number {
  const matches = raw.match(/"(?:\\.|[^"\\])*"/g);
  return matches?.length ?? 0;
}

function looksLikeStringList(raw: string): boolean {
  return countQuotedStrings(raw) >= 1;
}

function looksLikeBitsCellArray(raw: string): boolean {
  return /^\/bits\/\s+(8|16)\s+<[^>]+>$/.test(raw.trim());
}

function validateDebugValueAgainstConstraints(
  raw: string,
  candidate: DtsReloadCandidate
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "请输入调试值。";

  if (candidate.valueShapeKind === "string") {
    if (countQuotedStrings(trimmed) !== 1) {
      return '调试值必须是单个字符串，例如 "bat0_raw_temp"。';
    }
    return null;
  }

  if (candidate.valueShapeKind === "string-list") {
    if (!looksLikeStringList(trimmed)) {
      return '调试值必须是字符串列表，例如 "okay" 或 "a", "b"。';
    }
    return null;
  }

  if (isPhandleCellFamilyKind(candidate.valueShapeKind)) {
    const groups = parsePhandleCellGroups(trimmed);
    if (!groups) {
      return "调试值必须是 GPIO 风格 phandle 数组，例如 <&gpio13 29 0>。";
    }
    const { constraints } = candidate;
    const expectedCells = typeof constraints.cells === "number" ? constraints.cells : undefined;
    const min = typeof constraints.min === "number" ? constraints.min : undefined;
    const max = typeof constraints.max === "number" ? constraints.max : undefined;
    if (expectedCells !== undefined && groups.some((group) => group.width !== expectedCells)) {
      return `调试值 cell 数量应为 ${expectedCells}，当前为 ${groups.map((group) => group.width).join(", ")}。`;
    }
    const integers = groups.flatMap((group) => group.integers);
    if (min !== undefined && integers.some((value) => value < min)) {
      return `调试值低于声明的最小值 ${min}。`;
    }
    if (max !== undefined && integers.some((value) => value > max)) {
      return `调试值超过声明的最大值 ${max}。`;
    }
    return null;
  }

  if (candidate.valueShapeKind === "bytes") {
    if (!looksLikeBitsCellArray(trimmed)) {
      return "调试值必须是 /bits/ 8 cell 数组，例如 /bits/ 8 <17>。";
    }
    const numeric = parseCellIntegers(trimmed);
    if (numeric === null) {
      return "调试值必须是 /bits/ 8 cell 数组，例如 /bits/ 8 <17>。";
    }
    if (numeric.some((value) => value < 0 || value > 255)) {
      return "调试值中的每个 byte 必须在 0–255 范围内。";
    }
    const { constraints } = candidate;
    const expectedCells = typeof constraints.cells === "number" ? constraints.cells : undefined;
    if (expectedCells !== undefined && numeric.length !== expectedCells) {
      return `调试值 cell 数量应为 ${expectedCells}，当前为 ${numeric.length}。`;
    }
    return null;
  }

  const numeric = parseCellIntegers(trimmed);
  if (numeric === null) {
    return "调试值必须是 u32 cell 数组，例如 <7000>、<0x1770> 或 <1 2 3>。";
  }

  const { constraints } = candidate;
  const expectedCells = typeof constraints.cells === "number" ? constraints.cells : undefined;
  const min = typeof constraints.min === "number" ? constraints.min : undefined;
  const max = typeof constraints.max === "number" ? constraints.max : undefined;
  if (expectedCells !== undefined && numeric.length !== expectedCells) {
    return `调试值 cell 数量应为 ${expectedCells}，当前为 ${numeric.length}。`;
  }
  if (min !== undefined && numeric.some((value) => value < min)) {
    return `调试值低于声明的最小值 ${min}。`;
  }
  if (max !== undefined && numeric.some((value) => value > max)) {
    return `调试值超过声明的最大值 ${max}。`;
  }
  return null;
}

function readRunIdFromSearch(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("run") || null;
}

function writeRunIdToSearch(runId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (runId) {
    url.searchParams.set("run", runId);
  } else {
    url.searchParams.delete("run");
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function defaultDeviceId(bridgeId: string): string {
  return `bridge:${bridgeId}`;
}

function formatAttemptedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function integrityCheckLabel(check: DtsReloadIntegrityCheck): string {
  switch (check) {
    case "byte-length":
      return "仅长度校验";
    case "md5":
      return "MD5 摘要匹配";
    case "sha256":
      return "SHA256 摘要匹配";
    default:
      return check;
  }
}

function statusBadgeClass(status: DtsReloadRun["status"]): string {
  switch (status) {
    case "validated":
    case "verified":
      return "bg-emerald-100 text-emerald-900";
    case "deploying":
      return "bg-sky-100 text-sky-900";
    case "failed":
    case "contradicted":
      return "bg-rose-100 text-rose-950";
    case "unverifiable":
      return "bg-amber-100 text-amber-950";
    case "blocked":
      return "bg-amber-100 text-amber-950";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function verificationOutcomeClass(outcome: DtsReloadParameterVerification["outcome"]): string {
  switch (outcome) {
    case "verified":
      return "text-emerald-800";
    case "contradicted":
      return "text-rose-900";
    case "read-failed":
      return "text-amber-900";
    case "unbound":
    default:
      return "text-muted-foreground";
  }
}

function verificationOutcomeDescription(entry: DtsReloadParameterVerification): string {
  switch (entry.outcome) {
    case "verified":
      return "调试节点读回与调试值在参数值形状下一致。";
    case "contradicted":
      return "调试节点读回与调试值不一致。";
    case "unbound":
      return "该参数没有可用的调试节点绑定，因此无法行为验证——这不是读取失败。";
    case "read-failed":
      return entry.reason?.trim()
        ? `调试节点读取失败：${entry.reason}`
        : "调试节点读取失败；该参数保持未验证，不影响整次运行成败。";
    default:
      return entry.reason ?? "";
  }
}

function stepOutcomeClass(outcome: string): string {
  switch (outcome) {
    case "passed":
      return "text-emerald-800";
    case "failed":
      return "text-rose-900";
    case "running":
      return "text-sky-800";
    case "skipped":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

function ReloadSnapshotSummary({ snapshot }: { snapshot: DtsReloadSnapshot }) {
  const digest = snapshot.artifactDigest;
  const signal = snapshot.kernelSignal;
  const verification = snapshot.behaviouralVerification;
  const obtained = signal?.captureStatus === "obtained";
  const matchedGroups = signal?.matchedByParameter ?? [];
  const hasMatches = matchedGroups.some((group) => group.lines.length > 0);
  const outcomes = verification?.outcomes ?? [];

  return (
    <div className="rounded-md border bg-muted/20 p-3 text-xs">
      <p className="font-medium">重载快照</p>
      <p className="mt-1 text-muted-foreground">
        库基线记录 {snapshot.libraryBaselines.length} 条
      </p>
      {digest ? (
        <div className="mt-2 space-y-1 font-mono">
          <p>产物 SHA256：{digest.sha256}</p>
          {digest.onDeviceDigest ? <p>设备端摘要：{digest.onDeviceDigest}</p> : null}
          {digest.integrityCheck ? (
            <p>完整性校验：{integrityCheckLabel(digest.integrityCheck)}</p>
          ) : null}
        </div>
      ) : null}
      {outcomes.length > 0 ? (
        <div className="mt-3 space-y-2 border-t pt-3" aria-label="行为验证结果">
          <p className="font-medium">行为验证（按参数）</p>
          <p className="text-muted-foreground">
            通过已有调试节点绑定读取驱动表面值，并按参数声明的值形状与调试值比较。缺少绑定是诚实缺口，不是失败。
          </p>
          <ul className="space-y-2">
            {outcomes.map((entry) => (
              <li key={entry.bindingId} className="rounded-md border bg-background p-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium font-mono">{entry.propertyKey}</span>
                  <span className={cn("font-medium", verificationOutcomeClass(entry.outcome))}>
                    {dtsReloadVerificationOutcomeLabels[entry.outcome]}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{verificationOutcomeDescription(entry)}</p>
                {entry.nodePath ? (
                  <p className="mt-1 font-mono text-muted-foreground">节点：{entry.nodePath}</p>
                ) : null}
                {entry.readValue !== null && entry.readValue !== undefined ? (
                  <p className="mt-1 font-mono">读回：{entry.readValue}</p>
                ) : null}
                {entry.outcome !== "unbound" && entry.expectedValue ? (
                  <p className="mt-1 font-mono text-muted-foreground">期望：{entry.expectedValue}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {signal ? (
        <div className="mt-3 space-y-2 border-t pt-3" aria-label="内核日志证据">
          <p className="font-medium">内核日志证据（未判定）</p>
          <p className="text-muted-foreground">
            以下内容仅为采集到的内核日志证据。平台<strong>没有</strong>据此推断重载成功或失败。
          </p>
          <p className="font-mono text-muted-foreground">命令：{signal.command}</p>
          {obtained ? (
            <>
              {signal.truncated ? (
                <p className="text-amber-900">
                  {isStreamingKernelLogCommand(signal.command)
                    ? "采集超过字节上限，已截断并保留最早输出。"
                    : "采集超过字节上限，已截断并保留最新输出。"}
                </p>
              ) : null}
              {hasMatches ? (
                <div className="space-y-2" aria-label="按参数名分组的匹配行">
                  {matchedGroups.map((group) =>
                    group.lines.length > 0 ? (
                      <div key={`${group.bindingId}-${group.parameterName}`}>
                        <p className="font-medium font-mono">{group.parameterName}</p>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-2 font-mono text-[11px]">
                          {group.lines.join("\n")}
                        </pre>
                      </div>
                    ) : null
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">已采集到内核日志，但没有匹配到本运行参数名或节点名的行。</p>
              )}
              {signal.rawText ? (
                <details className="rounded-md border bg-background p-2">
                  <summary className="cursor-pointer font-medium">查看未过滤的完整采集</summary>
                  <pre
                    aria-label="未过滤的内核日志采集"
                    className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px]"
                  >
                    {signal.rawText}
                  </pre>
                </details>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">
              未获得内核日志信号
              {signal.captureError ? `：${signal.captureError}` : "。"}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RunStepsList({ steps }: { steps: DtsReloadRun["steps"] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="dts-reload-run-steps" aria-label="运行步骤">
      {steps.map((step, index) => (
        <li
          key={`${step.step}-${index}`}
          className="dts-reload-run-steps__item"
          data-outcome={step.outcome}
        >
          <div className="dts-reload-run-steps__head">
            <span className="dts-reload-run-steps__name">
              {dtsReloadStepLabels[step.step] ?? step.step}
            </span>
            <span className={cn("dts-reload-run-steps__outcome", stepOutcomeClass(step.outcome))}>
              {dtsReloadStepOutcomeLabels[step.outcome] ?? step.outcome}
            </span>
          </div>
          {step.error ? <p className="dts-reload-run-steps__error">{step.error}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function DeployConfirmBody({
  run,
  deviceId,
  targetRef,
  bridgeMachineLabel,
  residue
}: {
  run: DtsReloadRun;
  deviceId: string;
  targetRef: string;
  bridgeMachineLabel: string;
  residue: DtsReloadResidue | null;
}) {
  const isRestore = run.purpose === "restore-baseline";
  return (
    <div className="flex flex-col gap-3 text-sm">
      {isRestore ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          这是一次<strong>补偿性重载</strong>，不是撤销。已应用的调试 overlay
          无法卸载；本次会以库基线值作为调试值重新部署一层。
        </p>
      ) : null}
      {residue ? <ResidueIndicator residue={residue} deviceId={deviceId} /> : null}
      <dl className="grid gap-1 text-xs">
        <div>
          <dt className="font-medium">目标设备</dt>
          <dd className="font-mono text-muted-foreground">
            {deviceId} · {targetRef}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Bridge 机器</dt>
          <dd>{bridgeMachineLabel}</dd>
        </div>
        <div>
          <dt className="font-medium">参数数量</dt>
          <dd>{run.targets.length}</dd>
        </div>
      </dl>
      {run.targets.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-medium">{isRestore ? "将部署的基线值" : "参数变更"}</p>
          <ul className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-2 text-xs">
            {run.targets.map((target) => (
              <li key={target.bindingId}>
                <div className="font-medium">{target.propertyKey}</div>
                <div className="font-mono text-muted-foreground">{target.nodePath}</div>
                <div className="font-mono">
                  {isRestore
                    ? target.debugValue
                    : `${target.baselineValue ?? "—"} → ${target.debugValue}`}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {run.overlaySource ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium">Overlay 源码</span>
          <textarea
            aria-label="部署确认 Overlay 源码"
            className="min-h-[180px] rounded-md border bg-muted/20 p-2 font-mono text-xs"
            readOnly
            value={run.overlaySource}
          />
        </label>
      ) : null}
    </div>
  );
}

function ResidueIndicator({
  residue,
  deviceId
}: {
  residue: DtsReloadResidue;
  deviceId: string;
}) {
  const parameterNames = residue.parameters.map((entry) => entry.propertyKey).join("、") || "（无参数）";
  return (
    <aside
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950"
      aria-label="重载残留指示"
      data-testid="reload-residue-indicator"
    >
      <p className="font-semibold">设备可能携带调试残留</p>
      <p className="mt-1 text-xs">
        设备 <span className="font-mono">{deviceId || residue.deviceId}</span> 的平台记账显示，运行{" "}
        <span className="font-mono">{residue.sourceRunId}</span> 曾部署调试值（参数：{parameterNames}）。
      </p>
      <p className="mt-2 text-xs leading-relaxed">
        这是<strong>平台根据运行历史做的记账</strong>，无法从设备侧确认。重启、重新刷机，或在平台之外做的任何改动，都会使该指示失效。
      </p>
    </aside>
  );
}

export function DtsReloadPage({
  projects,
  initialProjectId,
  repository,
  canStartRun,
  unavailableReason,
  bridges: bridgesProp,
  listBridges,
  probeBridgeHealth,
  detectTargets,
  initialTargetRef,
  moduleRegistryRepository
}: DtsReloadPageProps) {
  const moduleRegistryRepo = useMemo(
    () =>
      moduleRegistryRepository === null
        ? null
        : (moduleRegistryRepository ?? resolveParameterModuleRegistryRepository()),
    [moduleRegistryRepository]
  );
  const [moduleRegistry, setModuleRegistry] = useState<ParameterModuleRegistry>(
    EMPTY_PARAMETER_MODULE_REGISTRY
  );
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? "");
  const [candidates, setCandidates] = useState<DtsReloadCandidate[]>([]);
  const [selectedBindingIds, setSelectedBindingIds] = useState<string[]>([]);
  const [debugValues, setDebugValues] = useState<Record<string, string>>({});
  const [run, setRun] = useState<DtsReloadRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [deployError, setDeployError] = useState("");
  const [deployUpgradeReleasesPath, setDeployUpgradeReleasesPath] = useState<string | null>(null);
  const [nameQuery, setNameQuery] = useState("");
  const [moduleColumnFilter, setModuleColumnFilter] = useState<string[]>([]);
  const [selectedModuleNodeId, setSelectedModuleNodeId] = useState<string | null>(null);
  const [editingBindingId, setEditingBindingId] = useState<string | null>(null);
  const [criticalConfirmed, setCriticalConfirmed] = useState(false);
  const [bridges, setBridges] = useState<BridgeOption[]>(bridgesProp ?? []);
  const [bridgeHealth, setBridgeHealth] = useState<Pick<LocalBridgeHealthState, "connected" | "bridgeId"> | null>(
    null
  );
  const [reachableTargets, setReachableTargets] = useState<DtsReloadReachableTarget[]>([]);
  const [detectingTargets, setDetectingTargets] = useState(false);
  const [bridgeId, setBridgeId] = useState("");
  const [targetRef, setTargetRef] = useState(initialTargetRef ?? "");
  const [protocol, setProtocol] = useState<DeployProtocol>("hdc");
  const [deviceId, setDeviceId] = useState("");
  const [deviceIdTouched, setDeviceIdTouched] = useState(false);
  const [deployConfirmOpen, setDeployConfirmOpen] = useState(false);
  const [pendingDeployRun, setPendingDeployRun] = useState<DtsReloadRun | null>(null);
  const [residue, setResidue] = useState<DtsReloadResidue | null>(null);
  const [residueLoading, setResidueLoading] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [restoreCriticalConfirmed, setRestoreCriticalConfirmed] = useState(false);
  const [historyItems, setHistoryItems] = useState<DtsReloadRunListItem[]>([]);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyFilterDevice, setHistoryFilterDevice] = useState(false);
  const historyQueryKeyRef = useRef(0);

  const selectedBridge = useMemo(
    () => bridges.find((bridge) => bridge.id === bridgeId) ?? null,
    [bridges, bridgeId]
  );

  const targetsForSelectedBridge = useMemo(
    () =>
      reachableTargets.filter(
        (target) => !target.bridgeId || !bridgeId || target.bridgeId === bridgeId
      ),
    [reachableTargets, bridgeId]
  );

  useEffect(() => {
    if (!moduleRegistryRepo) {
      setModuleRegistry(EMPTY_PARAMETER_MODULE_REGISTRY);
      return undefined;
    }
    let cancelled = false;
    moduleRegistryRepo
      .getRegistry()
      .then((registry) => {
        if (!cancelled) setModuleRegistry(registry);
      })
      .catch(() => {
        if (!cancelled) setModuleRegistry(EMPTY_PARAMETER_MODULE_REGISTRY);
      });
    return () => {
      cancelled = true;
    };
  }, [moduleRegistryRepo]);

  const moduleTree = useMemo(
    () => buildReloadModuleTree({ candidates, modules: moduleRegistry.modules }),
    [candidates, moduleRegistry.modules]
  );

  const selectedModuleNode = useMemo(
    () =>
      selectedModuleNodeId ? findWorkbenchTreeNode(moduleTree, selectedModuleNodeId) : null,
    [moduleTree, selectedModuleNodeId]
  );

  useEffect(() => {
    if (selectedModuleNodeId && !selectedModuleNode) {
      setSelectedModuleNodeId(null);
    }
  }, [selectedModuleNodeId, selectedModuleNode]);

  const selectedModuleBindingIds = useMemo(
    () => (selectedModuleNode ? collectSubtreeBindingIds(selectedModuleNode) : null),
    [selectedModuleNode]
  );

  const scopedCandidates = useMemo(() => {
    const normalizedQuery = nameQuery.trim().toLocaleLowerCase();
    return candidates.filter((candidate) => {
      if (selectedModuleBindingIds && !selectedModuleBindingIds.has(candidate.bindingId)) return false;
      if (!normalizedQuery) return true;
      const haystack = [candidate.displayName, candidate.propertyKey].join(" ").toLocaleLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [candidates, nameQuery, selectedModuleBindingIds]);

  const moduleFilterOptions = useMemo(
    () =>
      Array.from(new Set(scopedCandidates.map((candidate) => candidateModuleLabel(candidate)))).sort((left, right) =>
        left.localeCompare(right, "zh-Hans-CN")
      ),
    [scopedCandidates]
  );

  const activeModuleColumnFilter = useMemo(
    () => moduleColumnFilter.filter((name) => moduleFilterOptions.includes(name)),
    [moduleColumnFilter, moduleFilterOptions]
  );

  const filtered = useMemo(() => {
    if (activeModuleColumnFilter.length === 0) return scopedCandidates;
    const selected = new Set(activeModuleColumnFilter);
    return scopedCandidates.filter((candidate) => selected.has(candidateModuleLabel(candidate)));
  }, [activeModuleColumnFilter, scopedCandidates]);

  const selectedCandidates = useMemo(
    () =>
      selectedBindingIds
        .map((bindingId) => candidates.find((candidate) => candidate.bindingId === bindingId))
        .filter((candidate): candidate is DtsReloadCandidate => Boolean(candidate)),
    [candidates, selectedBindingIds]
  );

  const editingCandidate = useMemo(
    () =>
      editingBindingId
        ? candidates.find(
            (candidate) => candidate.bindingId === editingBindingId && candidate.debuggable
          ) ?? null
        : null,
    [candidates, editingBindingId]
  );

  useEffect(() => {
    if (editingBindingId && !editingCandidate) {
      setEditingBindingId(null);
    }
  }, [editingBindingId, editingCandidate]);

  const selectedHasCriticalSensitive = selectedCandidates.some(
    (candidate) => candidate.sensitiveMatch?.riskTier === "critical"
  );
  const selectedHasSensitive = selectedCandidates.some((candidate) => Boolean(candidate.sensitiveMatch));
  const selectedHasMeaningfulDebugChange = selectedCandidates.some((candidate) =>
    hasMeaningfulDebugChange(debugValues[candidate.bindingId] ?? "", candidate.baselineValue)
  );

  const deployReady = Boolean(bridgeId.trim() && targetRef.trim() && deviceId.trim());

  const bridgesOverride = useMemo(
    () => (bridgesProp ? asDeviceBridgeRecords(bridgesProp) : undefined),
    [bridgesProp]
  );

  const listBridgesForPanel = useMemo(
    () =>
      listBridges
        ? async () => asDeviceBridgeRecords(await listBridges())
        : undefined,
    [listBridges]
  );

  const probeHealthForPanel = useMemo(
    () => (probeBridgeHealth ? adaptProbeBridgeHealth(probeBridgeHealth) : undefined),
    [probeBridgeHealth]
  );

  const handleBridgeStateChange = useCallback((state: LocalDeviceBridgePanelState) => {
    const nextBridges = state.bridges
      .filter((bridge) => !bridge.revokedAt)
      .map((bridge) => ({
        id: bridge.id,
        machineLabel: bridge.machineLabel,
        lastSeenAt: bridge.lastSeenAt
      }));
    setBridges((current) => {
      if (
        current.length === nextBridges.length &&
        current.every(
          (bridge, index) =>
            bridge.id === nextBridges[index]?.id &&
            bridge.machineLabel === nextBridges[index]?.machineLabel &&
            bridge.lastSeenAt === nextBridges[index]?.lastSeenAt
        )
      ) {
        return current;
      }
      return nextBridges;
    });
    setBridgeHealth((current) => {
      const next = state.health
        ? { connected: state.health.connected, bridgeId: state.health.bridgeId }
        : null;
      if (
        current?.connected === next?.connected &&
        current?.bridgeId === next?.bridgeId &&
        Boolean(current) === Boolean(next)
      ) {
        return current;
      }
      return next;
    });
    const preferred =
      (state.health?.bridgeId && nextBridges.some((bridge) => bridge.id === state.health?.bridgeId)
        ? state.health.bridgeId
        : null) ??
      nextBridges[0]?.id ??
      "";
    setBridgeId((current) => (current && nextBridges.some((bridge) => bridge.id === current) ? current : preferred));
  }, []);

  const runDetectTargets = useCallback(async () => {
    if (!detectTargets) {
      setReachableTargets([]);
      return;
    }
    setDetectingTargets(true);
    try {
      const targets = await detectTargets(protocol);
      setReachableTargets(targets);
      if (targets.length === 1) {
        const only = targets[0]!.targetRef.trim();
        if (only) {
          setTargetRef((current) => (current.trim() ? current : only));
        }
      }
    } catch {
      setReachableTargets([]);
    } finally {
      setDetectingTargets(false);
    }
  }, [detectTargets, protocol]);

  useEffect(() => {
    if (!repository || !detectTargets || bridges.length === 0) {
      setReachableTargets([]);
      return;
    }
    void runDetectTargets();
  }, [repository, detectTargets, protocol, bridges.length, runDetectTargets]);

  useEffect(() => {
    if (!bridgeId || deviceIdTouched) return;
    setDeviceId(defaultDeviceId(bridgeId));
  }, [bridgeId, deviceIdTouched]);

  useEffect(() => {
    if (!repository || !deviceId.trim()) {
      setResidue(null);
      return;
    }
    if (
      import.meta.env.DEV &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("uiPreview") === "residue"
    ) {
      return;
    }
    let cancelled = false;
    setResidueLoading(true);
    void repository
      .getResidue(deviceId.trim())
      .then((item) => {
        if (!cancelled) setResidue(item);
      })
      .catch(() => {
        // Keep any previously shown bookkeeping if the lookup fails transiently.
      })
      .finally(() => {
        if (!cancelled) setResidueLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repository, deviceId]);

  useEffect(() => {
    if (!repository || !projectId) {
      setHistoryItems([]);
      setHistoryNextCursor(null);
      return;
    }
    if (
      import.meta.env.DEV &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("uiPreview") === "history"
    ) {
      return;
    }
    const filterByDevice = historyFilterDevice && Boolean(deviceId.trim());
    if (historyFilterDevice && !deviceId.trim()) {
      setHistoryFilterDevice(false);
      return;
    }
    let cancelled = false;
    const queryKey = ++historyQueryKeyRef.current;
    setHistoryLoading(true);
    setHistoryNextCursor(null);
    setHistoryItems([]);
    setHistoryError("");
    void repository
      .listRuns({
        projectId,
        ...(filterByDevice ? { deviceId: deviceId.trim() } : {}),
        limit: 10
      })
      .then((result) => {
        if (cancelled || queryKey !== historyQueryKeyRef.current) return;
        setHistoryItems(result.items);
        setHistoryNextCursor(result.nextCursor);
      })
      .catch((error) => {
        if (cancelled || queryKey !== historyQueryKeyRef.current) return;
        setHistoryItems([]);
        setHistoryNextCursor(null);
        setHistoryError(error instanceof Error ? error.message : "加载运行历史失败。");
      })
      .finally(() => {
        if (!cancelled && queryKey === historyQueryKeyRef.current) {
          setHistoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repository, projectId, historyFilterDevice, historyFilterDevice ? deviceId : ""]);

  useEffect(() => {
    if (!selectedHasCriticalSensitive) {
      setCriticalConfirmed(false);
    }
  }, [selectedHasCriticalSensitive]);

  useEffect(() => {
    if (!repository || !projectId) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMessage("");
    void repository
      .listCandidates(projectId)
      .then(async (result) => {
        if (cancelled) return;
        setCandidates(result.items);
        const firstDebuggable = result.items.find((item) => item.debuggable);
        if (firstDebuggable) {
          setSelectedBindingIds([firstDebuggable.bindingId]);
          setDebugValues({ [firstDebuggable.bindingId]: firstDebuggable.baselineValue ?? "" });
        } else {
          setSelectedBindingIds([]);
          setDebugValues({});
        }
        const existingRunId = readRunIdFromSearch();
        if (existingRunId) {
          try {
            const existing = await repository.getRun(existingRunId);
            if (!cancelled && existing.projectId === projectId) {
              setRun(existing);
              if (existing.bridgeId) setBridgeId(existing.bridgeId);
              if (existing.targetRef) setTargetRef(existing.targetRef);
              if (existing.deviceId) {
                setDeviceId(existing.deviceId);
                setDeviceIdTouched(true);
              }
              if (existing.protocol === "hdc" || existing.protocol === "adb") {
                setProtocol(existing.protocol);
              }
              return;
            }
          } catch {
            writeRunIdToSearch(null);
          }
        }
        // DEV-only visual QA hooks for playwright-cli screenshots.
        // Quarantined: do not expand; ignored outside import.meta.env.DEV.
        if (import.meta.env.DEV && typeof window !== "undefined") {
          const preview = new URLSearchParams(window.location.search).get("uiPreview");
          if (preview === "history") {
            setDeviceId("bridge:preview");
            setDeviceIdTouched(true);
            setTargetRef("AURORA-PREVIEW");
            setCandidates(
              result.items.map((item, index) =>
                index === 0
                  ? {
                      ...item,
                      lastReload: {
                        runId: "preview-history-failed",
                        debugValue: "<7000>",
                        attemptedAt: "2026-08-10T11:00:00.000Z",
                        outcome: "failed",
                        purpose: "ordinary"
                      }
                    }
                  : item
              )
            );
            setHistoryItems([
              {
                id: "preview-history-restore",
                projectId,
                deviceId: "bridge:preview",
                status: "verified",
                purpose: "restore-baseline",
                failureCode: null,
                targetCount: 1,
                propertyKeys: ["watchdog_time"],
                artifact: { fileName: "debug-overlay-preview-history-restore.dtbo", sha256: "sha-restore", sizeBytes: 40 },
                integrityCheck: "sha256",
                createdAt: "2026-08-10T12:00:00.000Z",
                completedAt: "2026-08-10T12:00:03.000Z"
              },
              {
                id: "preview-history-failed",
                projectId,
                deviceId: "bridge:preview",
                status: "failed",
                purpose: "ordinary",
                failureCode: "transfer-failed",
                targetCount: 1,
                propertyKeys: ["watchdog_time"],
                artifact: { fileName: "debug-overlay-preview-history-failed.dtbo", sha256: "sha-failed", sizeBytes: 32 },
                integrityCheck: "md5",
                createdAt: "2026-08-10T11:00:00.000Z",
                completedAt: "2026-08-10T11:00:02.000Z"
              },
              {
                id: "preview-history-blocked",
                projectId,
                deviceId: null,
                status: "blocked",
                purpose: "ordinary",
                failureCode: "base-compile-failed",
                targetCount: 1,
                propertyKeys: ["watchdog_time"],
                artifact: null,
                integrityCheck: null,
                createdAt: "2026-08-10T10:00:00.000Z",
                completedAt: "2026-08-10T10:00:01.000Z"
              }
            ]);
            setHistoryNextCursor(null);
            setRun({
              id: "preview-history-restore",
              projectId,
              configRevisionId: null,
              status: "verified",
              purpose: "restore-baseline",
              restoresSourceRunId: "preview-history-failed",
              failureCode: null,
              targets: [
                {
                  bindingId: "binding-1",
                  nodePath: "/amba/i2c@1/dev@6E",
                  propertyKey: "watchdog_time",
                  baselineValue: "<6000>",
                  debugValue: "<6000>"
                }
              ],
              steps: [
                { step: "compile-base", outcome: "passed" },
                { step: "compile-overlay", outcome: "passed" },
                { step: "dry-run-merge", outcome: "passed" },
                { step: "assert-effect", outcome: "passed" },
                { step: "mount-target", outcome: "passed" },
                { step: "transfer-artifact", outcome: "passed" },
                { step: "trigger-reload", outcome: "passed" }
              ],
              diagnostics: [],
              toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
              overlaySource: "/dts-v1/;\n/plugin/;\n",
              overlaySourceSha256: "src-sha",
              artifact: {
                fileName: "debug-overlay-preview-history-restore.dtbo",
                sha256: "sha-restore",
                sizeBytes: 40
              },
              deviceId: "bridge:preview",
              bridgeId: "bridge-preview",
              bridgeMachineLabel: "Preview Lab",
              targetRef: "AURORA-PREVIEW",
              protocol: "hdc",
              integrityCheck: "sha256",
              artifactRetentionExpired: false,
              reloadSnapshot: {
                libraryBaselines: [
                  {
                    bindingId: "binding-1",
                    propertyKey: "watchdog_time",
                    nodePath: "/amba/i2c@1/dev@6E",
                    baselineValue: "<6000>"
                  }
                ],
                artifactDigest: {
                  sha256: "sha-restore",
                  onDeviceDigest: "sha-restore",
                  integrityCheck: "sha256"
                },
                kernelSignal: {
                  command: "dmesg",
                  captureStatus: "obtained",
                  captureError: null,
                  rawText: "watchdog_time applied",
                  truncated: false,
                  matchedByParameter: [
                    {
                      parameterName: "watchdog_time",
                      bindingId: "binding-1",
                      lines: ["watchdog_time applied"]
                    }
                  ],
                  excerpt: null
                },
                behaviouralVerification: {
                  outcomes: [
                    {
                      bindingId: "binding-1",
                      propertyKey: "watchdog_time",
                      outcome: "verified",
                      debugNodeId: "node-1",
                      nodePath: "/sys/watchdog",
                      expectedValue: "<6000>",
                      readValue: "6000",
                      reason: null
                    }
                  ]
                }
              },
              createdAt: "2026-08-10T12:00:00.000Z",
              completedAt: "2026-08-10T12:00:03.000Z"
            });
            writeRunIdToSearch("preview-history-restore");
            return;
          }
          if (preview === "residue") {
            setDeviceId("bridge:preview");
            setDeviceIdTouched(true);
            setTargetRef("AURORA-PREVIEW");
            setResidue({
              deviceId: "bridge:preview",
              projectId,
              sourceRunId: "preview-residue-run",
              parameters: [
                {
                  bindingId: "binding-1",
                  propertyKey: "watchdog_time",
                  nodePath: "/amba/i2c@1/dev@6E",
                  baselineValue: "<6000>",
                  debugValue: "<7000>"
                },
                {
                  bindingId: "binding-2",
                  propertyKey: "input_current",
                  nodePath: "/amba/i2c@1/dev@6E",
                  baselineValue: "<3000>",
                  debugValue: "<3100>"
                }
              ],
              recordedAt: "2026-08-10T00:00:00.000Z"
            });
            setRun({
              id: "preview-residue-run",
              projectId,
              configRevisionId: null,
              status: "unverifiable",
              purpose: "ordinary",
              restoresSourceRunId: null,
              failureCode: null,
              targets: [
                {
                  bindingId: "binding-1",
                  nodePath: "/amba/i2c@1/dev@6E",
                  propertyKey: "watchdog_time",
                  baselineValue: "<6000>",
                  debugValue: "<7000>"
                }
              ],
              steps: [
                { step: "mount-target", outcome: "passed" },
                { step: "transfer-artifact", outcome: "passed" },
                { step: "trigger-reload", outcome: "passed" }
              ],
              diagnostics: [],
              toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
              overlaySource: null,
              overlaySourceSha256: null,
              artifact: null,
              deviceId: "bridge:preview",
              bridgeId: "bridge-preview",
              bridgeMachineLabel: "Preview Lab",
              targetRef: "AURORA-PREVIEW",
              protocol: "hdc",
              integrityCheck: "sha256",
              reloadSnapshot: null,
              createdAt: "2026-08-10T00:00:00.000Z",
              completedAt: "2026-08-10T00:00:02.000Z"
            });
            return;
          }
          if (preview === "kernel-signal" || preview === "behavioural-verify") {
            const verifiedPreview = preview === "behavioural-verify";
            setRun({
              id: "preview-run",
              projectId,
              configRevisionId: null,
              status: verifiedPreview ? "verified" : "unverifiable",
              purpose: "ordinary",
              restoresSourceRunId: null,
              failureCode: null,
              targets: [
                {
                  bindingId: "binding-1",
                  nodePath: "/amba/i2c@1/dev@6E",
                  propertyKey: "watchdog_time",
                  baselineValue: "<6000>",
                  debugValue: "<7000>"
                },
                {
                  bindingId: "binding-2",
                  nodePath: "/amba/i2c@1/dev@6E",
                  propertyKey: "input_current",
                  baselineValue: "<3000>",
                  debugValue: "<3100>"
                }
              ],
              steps: [
                { step: "mount-target", outcome: "passed" },
                { step: "transfer-artifact", outcome: "passed" },
                { step: "trigger-reload", outcome: "passed" }
              ],
              diagnostics: [],
              toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
              overlaySource: null,
              overlaySourceSha256: null,
              artifact: null,
              deviceId: "bridge:preview",
              bridgeId: "bridge-preview",
              bridgeMachineLabel: "Preview Lab",
              targetRef: "AURORA-PREVIEW",
              protocol: "hdc",
              integrityCheck: "sha256",
              reloadSnapshot: {
                libraryBaselines: [
                  {
                    bindingId: "binding-1",
                    propertyKey: "watchdog_time",
                    nodePath: "/amba/i2c@1/dev@6E",
                    baselineValue: "<6000>"
                  },
                  {
                    bindingId: "binding-2",
                    propertyKey: "input_current",
                    nodePath: "/amba/i2c@1/dev@6E",
                    baselineValue: "<3000>"
                  }
                ],
                artifactDigest: {
                  sha256: "preview-sha",
                  onDeviceDigest: "preview-sha",
                  integrityCheck: "sha256"
                },
                kernelSignal: {
                  command: "dmesg",
                  captureStatus: "obtained",
                  captureError: null,
                  rawText: "kernel: watchdog_time applied\nkernel: overlay reload ok\n",
                  truncated: false,
                  matchedByParameter: [
                    {
                      parameterName: "watchdog_time",
                      bindingId: "binding-1",
                      lines: ["kernel: watchdog_time applied"]
                    }
                  ],
                  excerpt: null
                },
                behaviouralVerification: verifiedPreview
                  ? {
                      outcomes: [
                        {
                          bindingId: "binding-1",
                          propertyKey: "watchdog_time",
                          outcome: "verified",
                          debugNodeId: "dbg-watchdog",
                          nodePath: "/sys/class/power_supply/battery/watchdog_time",
                          expectedValue: "<7000>",
                          readValue: "7000",
                          reason: null
                        },
                        {
                          bindingId: "binding-2",
                          propertyKey: "input_current",
                          outcome: "unbound",
                          debugNodeId: null,
                          nodePath: null,
                          expectedValue: "<3100>",
                          readValue: null,
                          reason: "No readable debug-node binding for this parameter and protocol."
                        }
                      ]
                    }
                  : {
                      outcomes: [
                        {
                          bindingId: "binding-1",
                          propertyKey: "watchdog_time",
                          outcome: "unbound",
                          debugNodeId: null,
                          nodePath: null,
                          expectedValue: "<7000>",
                          readValue: null,
                          reason: "No readable debug-node binding for this parameter and protocol."
                        }
                      ]
                    }
              },
              createdAt: "2026-08-10T00:00:00.000Z",
              completedAt: "2026-08-10T00:00:02.000Z"
            });
            return;
          }
        }
        setRun(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "加载参数候选失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, repository]);

  const openDeployConfirm = (validatedRun: DtsReloadRun) => {
    setPendingDeployRun(validatedRun);
    setDeployError("");
    setDeployUpgradeReleasesPath(null);
    setDeployConfirmOpen(true);
  };

  const closeDeployConfirm = () => {
    if (deploying) return;
    setDeployConfirmOpen(false);
    setPendingDeployRun(null);
    setDeployError("");
    setDeployUpgradeReleasesPath(null);
  };

  const onDeployConfirm = async () => {
    const deployRun = pendingDeployRun ?? (run?.status === "validated" || run?.status === "failed" ? run : null);
    if (!deployRun || !deployReady) return;

    setDeploying(true);
    setDeployError("");
    setDeployUpgradeReleasesPath(null);
    try {
      const deployed = await repository!.deployRun({
        runId: deployRun.id,
        deviceId: deviceId.trim(),
        bridgeId: bridgeId.trim(),
        targetRef: targetRef.trim(),
        protocol,
        confirmationTokens: [DTS_RELOAD_CONFIRMATION_TOKEN]
      });
      setRun(deployed);
      writeRunIdToSearch(deployed.id);
      setDeployConfirmOpen(false);
      setPendingDeployRun(null);
      const postWrite =
        deployed.status === "unverifiable" ||
        deployed.status === "verified" ||
        deployed.status === "contradicted";
      if (postWrite && deployed.purpose === "restore-baseline") {
        // Optimistic clear so a failed residue refresh cannot leave a stale banner.
        setResidue(null);
      }
      try {
        const nextResidue = await repository!.getResidue(deviceId.trim());
        setResidue(nextResidue);
      } catch {
        // Restore already cleared optimistically. Ordinary deploys keep prior residue on refresh failure.
      }
    } catch (error) {
      setDeployError(error instanceof Error ? error.message : "部署到设备失败。");
      setDeployUpgradeReleasesPath(readBridgeUpgradeReleasesPath(error));
    } finally {
      setDeploying(false);
    }
  };

  const openRestoreConfirm = () => {
    setRestoreError("");
    setRestoreCriticalConfirmed(false);
    setRestoreConfirmOpen(true);
  };

  const closeRestoreConfirm = () => {
    if (restoring) return;
    setRestoreConfirmOpen(false);
    setRestoreError("");
    setRestoreCriticalConfirmed(false);
  };

  const onRestoreConfirm = async () => {
    if (!repository || !projectId || !deviceId.trim()) return;
    if (restoreHasCriticalSensitive && !restoreCriticalConfirmed) {
      setRestoreError("critical 敏感参数恢复基线前须明确确认。");
      return;
    }
    setRestoring(true);
    setRestoreError("");
    try {
      const restoreRun = await repository.restoreBaseline({
        projectId,
        deviceId: deviceId.trim(),
        ...(restoreHasCriticalSensitive
          ? { confirmationToken: SENSITIVE_RELOAD_CONFIRMATION_TOKEN }
          : {})
      });
      setRun(restoreRun);
      writeRunIdToSearch(restoreRun.id);
      setRestoreConfirmOpen(false);
      setRestoreCriticalConfirmed(false);
      if (restoreRun.status === "validated") {
        openDeployConfirm(restoreRun);
      }
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : "启动基线恢复运行失败。");
    } finally {
      setRestoring(false);
    }
  };

  if (!repository) {
    return (
      <div className="workbench-page dts-reload-page">
        <div className="workbench-one-col">
          <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            {unavailableReason ?? "该页面仅在 API 模式下可用。Mock 运行时不提供参数调试。"}
          </p>
        </div>
      </div>
    );
  }

  const toggleSelected = (candidate: DtsReloadCandidate) => {
    if (!candidate.debuggable) return;
    setErrorMessage("");
    setSelectedBindingIds((current) => {
      if (current.includes(candidate.bindingId)) {
        return current.filter((id) => id !== candidate.bindingId);
      }
      setDebugValues((values) => ({
        ...values,
        [candidate.bindingId]: values[candidate.bindingId] ?? candidate.baselineValue ?? ""
      }));
      return [...current, candidate.bindingId];
    });
  };

  const removeFromReloadBatch = (bindingId: string) => {
    setErrorMessage("");
    setSelectedBindingIds((current) => current.filter((id) => id !== bindingId));
  };

  const clearReloadBatch = () => {
    setErrorMessage("");
    setSelectedBindingIds([]);
    setCriticalConfirmed(false);
  };

  const resetReloadBatchToBaseline = () => {
    setErrorMessage("");
    setDebugValues((values) => {
      const next = { ...values };
      for (const candidate of selectedCandidates) {
        next[candidate.bindingId] = candidate.baselineValue ?? "";
      }
      return next;
    });
  };

  const openCandidateEditor = (candidate: DtsReloadCandidate) => {
    if (!candidate.debuggable) return;
    setErrorMessage("");
    setEditingBindingId(candidate.bindingId);
  };

  const confirmCandidateDebugValue = (candidate: DtsReloadCandidate, debugValue: string): string | null => {
    if (!hasMeaningfulDebugChange(debugValue, candidate.baselineValue)) {
      return debugValue.trim()
        ? "调试值与库基线相同，无需加入本轮。"
        : "请输入调试值。";
    }
    const constraintError = validateDebugValueAgainstConstraints(debugValue, candidate);
    if (constraintError) return constraintError;
    setErrorMessage("");
    setDebugValues((values) => ({
      ...values,
      [candidate.bindingId]: debugValue
    }));
    setSelectedBindingIds((current) =>
      current.includes(candidate.bindingId) ? current : [...current, candidate.bindingId]
    );
    return null;
  };

  const onStart = async () => {
    if (!canStartRun || selectedCandidates.length === 0) return;

    if (!selectedHasMeaningfulDebugChange) {
      setErrorMessage("本轮调试值均与库基线相同或为空，请先修改后再下发。");
      return;
    }

    for (const candidate of selectedCandidates) {
      const constraintError = validateDebugValueAgainstConstraints(
        debugValues[candidate.bindingId] ?? "",
        candidate
      );
      if (constraintError) {
        setErrorMessage(`${candidate.displayName || candidate.propertyKey}：${constraintError}`);
        return;
      }
    }

    if (selectedHasCriticalSensitive && !criticalConfirmed) {
      setErrorMessage("所选参数包含 critical 敏感节点，请先勾选明确确认后再启动。");
      return;
    }

    setStarting(true);
    setErrorMessage("");
    try {
      const started = await repository.startRun({
        projectId,
        targets: selectedCandidates.map((candidate) => ({
          bindingId: candidate.bindingId,
          debugValue: (debugValues[candidate.bindingId] ?? "").trim()
        })),
        ...(selectedHasCriticalSensitive
          ? { confirmationToken: SENSITIVE_RELOAD_CONFIRMATION_TOKEN }
          : {})
      });
      setRun(started);
      writeRunIdToSearch(started.id);
      if (started.status === "validated" && deployReady) {
        openDeployConfirm(started);
      } else if (started.status === "validated" && !deployReady) {
        setErrorMessage("预检已通过。请先连接 Bridge 并检测设备目标后再确认部署。");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "下发参数失败。");
    } finally {
      setStarting(false);
    }
  };

  const onDownload = async () => {
    if (!run?.artifact) return;
    if (run.artifactRetentionExpired) {
      setErrorMessage("该运行的编译产物已超过保留期，无法下载（元数据与摘要仍可查看）。");
      return;
    }
    try {
      const blob = await repository.downloadArtifact(run.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = run.artifact.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "下载产物失败。");
    }
  };

  const onOpenHistoryRun = async (runId: string) => {
    if (!repository) return;
    if (
      import.meta.env.DEV &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("uiPreview") === "history" &&
      run
    ) {
      // Preview fixtures are client-only; switching among preview history rows keeps the
      // already-loaded detail shape and only swaps the selected history highlight via URL.
      if (runId === run.id || runId.startsWith("preview-history-")) {
        writeRunIdToSearch(runId);
        if (runId !== run.id && runId === "preview-history-failed") {
          setRun({
            ...run,
            id: "preview-history-failed",
            status: "failed",
            purpose: "ordinary",
            restoresSourceRunId: null,
            failureCode: "transfer-failed",
            artifactRetentionExpired: false,
            reloadSnapshot: null,
            overlaySource: null,
            diagnostics: [
              {
                stage: "transfer-artifact",
                code: "transfer-failed",
                message: "Artifact transfer to the device failed before reload could be triggered."
              }
            ],
            steps: [
              { step: "compile-base", outcome: "passed" },
              { step: "compile-overlay", outcome: "passed" },
              { step: "dry-run-merge", outcome: "passed" },
              { step: "assert-effect", outcome: "passed" },
              { step: "mount-target", outcome: "passed" },
              { step: "transfer-artifact", outcome: "failed", error: "hdc file send timed out" },
              { step: "trigger-reload", outcome: "skipped" }
            ]
          });
        } else if (runId === "preview-history-blocked") {
          setRun({
            ...run,
            id: "preview-history-blocked",
            status: "blocked",
            purpose: "ordinary",
            restoresSourceRunId: null,
            failureCode: "base-compile-failed",
            deviceId: null,
            bridgeId: null,
            bridgeMachineLabel: null,
            targetRef: null,
            integrityCheck: null,
            artifact: null,
            overlaySource:
              '/dts-v1/;\n/plugin/;\n\n/ {\n\tfragment@0 {\n\t\ttarget-path = "/amba/i2c@FF24E000/hl7603@75";\n\t};\n};\n',
            reloadSnapshot: null,
            diagnostics: [
              {
                stage: "compile-base",
                code: "base-compile-failed",
                message: "The compiled base device tree could not be read back for verification."
              }
            ],
            steps: [
              { step: "compile-base", outcome: "failed", error: "dtc exited with status 1" },
              { step: "compile-overlay", outcome: "skipped" },
              { step: "dry-run-merge", outcome: "skipped" },
              { step: "assert-effect", outcome: "skipped" }
            ]
          });
        } else if (runId === "preview-history-restore") {
          // Keep the richer restore preview already seeded on load.
          writeRunIdToSearch(runId);
        }
        return;
      }
    }
    setErrorMessage("");
    try {
      const existing = await repository.getRun(runId);
      setRun(existing);
      writeRunIdToSearch(existing.id);
      if (existing.bridgeId) setBridgeId(existing.bridgeId);
      if (existing.targetRef) setTargetRef(existing.targetRef);
      if (existing.deviceId) {
        setDeviceId(existing.deviceId);
        setDeviceIdTouched(true);
      }
      if (existing.protocol === "hdc" || existing.protocol === "adb") {
        setProtocol(existing.protocol);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载运行详情失败。");
    }
  };

  const onLoadMoreHistory = async () => {
    if (!repository || !projectId || !historyNextCursor || historyLoadingMore || historyLoading) return;
    const queryKey = historyQueryKeyRef.current;
    const cursor = historyNextCursor;
    const filterByDevice = historyFilterDevice && Boolean(deviceId.trim());
    setHistoryLoadingMore(true);
    setHistoryError("");
    try {
      const result = await repository.listRuns({
        projectId,
        ...(filterByDevice ? { deviceId: deviceId.trim() } : {}),
        cursor,
        limit: 10
      });
      if (queryKey !== historyQueryKeyRef.current) return;
      setHistoryItems((current) => [...current, ...result.items]);
      setHistoryNextCursor(result.nextCursor);
    } catch (error) {
      if (queryKey !== historyQueryKeyRef.current) return;
      setHistoryError(error instanceof Error ? error.message : "加载更多运行历史失败。");
    } finally {
      if (queryKey === historyQueryKeyRef.current) {
        setHistoryLoadingMore(false);
      }
    }
  };

  const confirmRun = pendingDeployRun ?? run;
  const canRetryDeploy = run?.status === "validated" || run?.status === "failed";
  const residueSensitiveCandidates = useMemo(() => {
    if (!residue) return [];
    const bindingIds = new Set(residue.parameters.map((entry) => entry.bindingId));
    return candidates.filter((candidate) => bindingIds.has(candidate.bindingId));
  }, [residue, candidates]);
  const restoreHasCriticalSensitive = residueSensitiveCandidates.some(
    (candidate) => candidate.sensitiveMatch?.riskTier === "critical"
  );
  const restoreHasSensitive = residueSensitiveCandidates.some((candidate) => Boolean(candidate.sensitiveMatch));

  const projectName = projects.find((project) => project.id === projectId)?.name ?? projectId;
  const bridgeStatusPill =
    bridges.length === 0
      ? "等待 Bridge"
      : selectedBridge && inferBridgeOnline(selectedBridge, bridgeHealth, { healthExclusive: true })
        ? `${selectedBridge.machineLabel} · 已连接`
        : selectedBridge
          ? `${selectedBridge.machineLabel} · 未连接`
          : "等待 Bridge";

  return (
    <div className="workbench-page dts-reload-page">
      <div className="workbench-one-col">
        {!canStartRun ? (
          <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            当前账号仅有调试查看权限：可浏览运行历史与参数上次重载状态，但无法启动、部署或恢复基线。需要{" "}
            <code className="rounded bg-amber-100 px-1">debugging:dts-reload</code> 才能执行变更。
          </p>
        ) : null}

        {errorMessage ? (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
            {errorMessage}
          </p>
        ) : null}

        <div className="node-debugging-controls dts-reload-controls">
          <div className="protocol-switch" role="group" aria-label="连接协议">
            {(["hdc", "adb"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={protocol === item ? "protocol-switch-button active" : "protocol-switch-button"}
                aria-pressed={protocol === item}
                disabled={!canStartRun}
                onClick={() => setProtocol(item)}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
          <label className="dts-reload-project-select">
            <span>项目</span>
            <select
              aria-label="选择项目"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <LocalDeviceBridgePanel
          target={targetRef.trim() || undefined}
          detecting={detectingTargets}
          protocol={protocol}
          onDetect={() => void runDetectTargets()}
          bridgesOverride={bridgesOverride}
          listBridges={listBridgesForPanel}
          probeHealth={probeHealthForPanel}
          onBridgeStateChange={handleBridgeStateChange}
        />

        {targetsForSelectedBridge.length > 1 ? (
          <section className="bridge-target-picker" aria-label="设备代理目标选择">
            <div className="bridge-target-picker__head">
              <strong>检测到多个设备代理目标</strong>
              <small>请选择要部署的设备后再启动重载。</small>
            </div>
            <ul className="bridge-target-picker__list">
              {targetsForSelectedBridge.map((target) => (
                <li key={`${target.bridgeId ?? "any"}:${target.targetRef}`}>
                  <button
                    type="button"
                    className={cn("button subtle", targetRef === target.targetRef ? "is-active" : undefined)}
                    disabled={!canStartRun}
                    aria-pressed={targetRef === target.targetRef}
                    onClick={() => setTargetRef(target.targetRef)}
                  >
                    {target.label?.trim() || target.targetRef}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {residue && !residueLoading ? (
          <div className="dts-reload-residue-banner" role="region" aria-label="重载残留">
            <ResidueIndicator residue={residue} deviceId={deviceId.trim()} />
            <button
              type="button"
              className="button subtle"
              disabled={!canStartRun || restoring || !deviceId.trim()}
              onClick={openRestoreConfirm}
            >
              恢复基线（补偿性重载）
            </button>
          </div>
        ) : null}

        {selectedCandidates.length > 0 ? (
          <div className="dts-parameter-workbench__current-edits dts-draft-tray dts-reload-run-tray-slot">
            {selectedHasSensitive ? (
              <p role="status" className="dts-reload-sensitive-banner">
                已选参数命中敏感节点规则：除 debugging:dts-reload 外还需要{" "}
                {Array.from(
                  new Set(
                    selectedCandidates
                      .map((candidate) => candidate.sensitiveMatch?.requiredCapability)
                      .filter((value): value is string => Boolean(value))
                  )
                ).join(" / ") || "parameter:edit-critical"}
                。
                {selectedHasCriticalSensitive ? " critical 层级还需在本轮托盘中明确确认。" : ""}
              </p>
            ) : null}

            <section
              className="dts-reload-run-tray dts-binding-draft-tray dts-draft-tray"
              role="region"
              aria-label="本轮重载"
            >
              <header>
                <div>
                  <p className="eyebrow">Reload batch</p>
                  <h3>本轮重载</h3>
                  <p>
                    {deployReady
                      ? "核对基线 → 调试值后启动预检；通过后需再确认部署到设备。调试值不会写回参数库。"
                      : "可先编辑调试值并启动预检；部署需先完成 Bridge 连接与目标检测。"}
                  </p>
                </div>
                <span>{`本轮 ${selectedCandidates.length} 项`}</span>
              </header>

              <div className="dts-binding-draft-tray__items dts-reload-run-tray__items">
                {selectedCandidates.map((candidate) => {
                  const sensitiveLabel = sensitiveBadgeLabel(candidate);
                  const debugValue = debugValues[candidate.bindingId] ?? "";
                  const baselineValue = candidate.baselineValue ?? "—";
                  return (
                    <article className="dts-binding-draft-tray__item" key={candidate.bindingId}>
                      <div className="dts-binding-draft-tray__item-heading">
                        <div>
                          <strong>{candidate.displayName || candidate.propertyKey}</strong>
                          <span>{candidateModuleLabel(candidate)}</span>
                          {sensitiveLabel ? (
                            <span
                              className={cn(
                                "dts-reload-sensitive-badge",
                                candidate.sensitiveMatch?.riskTier === "critical" && "is-critical"
                              )}
                            >
                              {sensitiveLabel}
                            </span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="button subtle"
                          aria-label={`移出本轮重载 ${candidate.displayName || candidate.propertyKey}`}
                          disabled={starting || !canStartRun}
                          onClick={() => removeFromReloadBatch(candidate.bindingId)}
                        >
                          <X size={15} strokeWidth={1.9} aria-hidden="true" />
                          移除
                        </button>
                      </div>
                      <div
                        className="dts-binding-draft-tray__diff"
                        aria-label={`${candidate.displayName || candidate.propertyKey} 值变更`}
                      >
                        <ParameterValueDiff baseValue={baselineValue} targetValue={debugValue || "—"} />
                      </div>
                      <p className="dts-reload-run-tray__meta">
                        {candidate.nodePath ?? "无路径"}
                      </p>
                      {candidate.sensitiveMatch ? (
                        <p className="dts-reload-run-tray__meta">
                          需要 {candidate.sensitiveMatch.requiredCapability}
                          {candidate.sensitiveMatch.requiresConfirmation ? "，并需明确确认" : ""}
                        </p>
                      ) : null}
                      <label className="dts-reload-run-tray__value">
                        <span>调试值</span>
                        <input
                          aria-label={`${candidate.displayName || candidate.propertyKey} 调试值`}
                          className="font-mono"
                          value={debugValue}
                          onChange={(event) =>
                            setDebugValues((values) => ({
                              ...values,
                              [candidate.bindingId]: event.target.value
                            }))
                          }
                          disabled={!canStartRun || starting}
                          placeholder={
                            candidate.valueShapeKind === "string"
                              ? '"bat0_raw_temp"'
                              : candidate.valueShapeKind === "string-list"
                              ? '"okay"'
                              : isPhandleCellFamilyKind(candidate.valueShapeKind)
                                ? "<&gpio13 29 0>"
                                : candidate.valueShapeKind === "bytes"
                                  ? "/bits/ 8 <17>"
                                  : "<7000>"
                          }
                        />
                      </label>
                    </article>
                  );
                })}
              </div>

              {selectedHasCriticalSensitive ? (
                <label className="dts-reload-critical-confirm">
                  <input
                    type="checkbox"
                    checked={criticalConfirmed}
                    onChange={(event) => setCriticalConfirmed(event.target.checked)}
                    aria-label="确认 critical 敏感节点重载"
                  />
                  <span>
                    我确认要为 critical 敏感参数下发调试值。调试值不会写回参数库；设备部署需另行确认。
                  </span>
                </label>
              ) : null}

              <div className="binding-draft-submission__actions dts-reload-run-tray__actions">
                <button
                  type="button"
                  className="button subtle"
                  disabled={starting}
                  onClick={resetReloadBatchToBaseline}
                >
                  重置为基线
                </button>
                <button
                  type="button"
                  className="button subtle"
                  disabled={starting}
                  onClick={clearReloadBatch}
                >
                  清空本轮
                </button>
                <button
                  type="button"
                  className="button primary"
                  aria-label={
                    starting ? "下发中" : `下发参数（${selectedCandidates.length}）`
                  }
                  onClick={() => void onStart()}
                  disabled={
                    !canStartRun ||
                    starting ||
                    !selectedHasMeaningfulDebugChange ||
                    (selectedHasCriticalSensitive && !criticalConfirmed)
                  }
                  title={
                    !selectedHasMeaningfulDebugChange
                      ? "本轮调试值均与库基线相同或为空"
                      : undefined
                  }
                >
                  {starting ? "下发中…" : `下发参数（${selectedCandidates.length}）`}
                </button>
              </div>
            </section>
          </div>
        ) : null}

        <section className="debug-table dts-reload-candidates">
          <div className="panel-header">
            <strong>可调试参数</strong>
            <span>
              {projectName} · {bridgeStatusPill}
            </span>
          </div>

          <div className="dts-parameter-workbench__body dts-reload-candidates-body">
            <div
              className="dts-parameter-workbench__navigator dts-workbench-topology"
              role="region"
              aria-label="模块导航"
            >
              <div className="dts-parameter-workbench__navigator-header">
                <h3 className="dts-parameter-workbench__navigator-title">模块导航</h3>
              </div>
              <DtsTopologyNavigator
                view="effective"
                nodes={moduleTree}
                selectedNodeId={selectedModuleNode?.id ?? null}
                defaultExpandDepth={2}
                labelKind="text"
                emptyMessage="暂无模块分组"
                ariaLabel="业务模块树"
                onSelectNode={(nodeId) =>
                  setSelectedModuleNodeId((current) => (current === nodeId ? null : nodeId))
                }
              />
            </div>

            <div className="dts-reload-candidates-results">
              <section className="parameters-table" aria-label="可调试参数">
                <div className="parameters-table-toolbar dts-reload-candidates-toolbar">
                  <label className="parameters-table-search">
                    <Search size={16} aria-hidden="true" />
                    <input
                      type="search"
                      aria-label="按名称搜索参数"
                      value={nameQuery}
                      onChange={(event) => setNameQuery(event.target.value)}
                      placeholder="参数名"
                    />
                  </label>
                  <span className="parameters-table-count">
                    Showing {filtered.length} of {candidates.length}
                  </span>
                </div>

            <div className="parameters-table-scroll table-wrap">
              <table className="parameters-table-grid dts-reload-candidates-grid">
                <colgroup>
                  <col className="dts-reload-col-select" />
                  <col className="dts-reload-col-param" />
                  <col className="dts-reload-col-module" />
                  <col className="dts-reload-col-baseline" />
                  <col className="dts-reload-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>选择</th>
                    <th>参数</th>
                    <th scope="col">
                      <div className="parameters-table-head-cell">
                        <span>模块</span>
                        <ColumnFilter
                          label="模块"
                          groupLabel="模块筛选"
                          values={moduleFilterOptions}
                          selectedValues={activeModuleColumnFilter}
                          onToggle={(value) =>
                            setModuleColumnFilter((current) =>
                              current.includes(value)
                                ? current.filter((item) => item !== value)
                                : [...current, value]
                            )
                          }
                          onClear={() => setModuleColumnFilter([])}
                        />
                      </div>
                    </th>
                    <th>库基线</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5}>加载中…</td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5}>当前筛选条件下没有可列出的参数。</td>
                    </tr>
                  ) : (
                    filtered.map((candidate) => {
                      const selected = selectedBindingIds.includes(candidate.bindingId);
                      return (
                        <tr
                          key={candidate.bindingId}
                          className={cn(
                            candidate.debuggable ? "cursor-pointer" : "opacity-80",
                            selected && "is-selected"
                          )}
                          onClick={() => toggleSelected(candidate)}
                        >
                          <td data-label="选择">
                            <input
                              type="checkbox"
                              aria-label={`选择 ${candidate.displayName || candidate.propertyKey}`}
                              checked={selected}
                              disabled={!candidate.debuggable}
                              onChange={() => toggleSelected(candidate)}
                              onClick={(event) => event.stopPropagation()}
                            />
                          </td>
                          <td data-label="参数">
                            <strong title={candidate.displayName || candidate.propertyKey}>
                              {candidate.displayName || candidate.propertyKey}
                            </strong>
                            <small title={candidate.nodePath ?? "无路径"}>
                              {candidate.nodePath ?? "无路径"}
                            </small>
                          </td>
                          <td data-label="模块" title={candidateModuleLabel(candidate)}>
                            {candidateModuleLabel(candidate)}
                          </td>
                          <td data-label="库基线">
                            <code title={candidate.baselineValue ?? undefined}>
                              {candidate.baselineValue ?? "—"}
                            </code>
                          </td>
                          <td
                            data-label="操作"
                            className="parameter-row-actions"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {candidate.debuggable ? (
                              <button
                                type="button"
                                className="button subtle dts-parameter-workbench-table__icon-action"
                                aria-label={`编辑 ${candidate.displayName || candidate.propertyKey}`}
                                title="编辑"
                                onClick={() => openCandidateEditor(candidate)}
                              >
                                <Pencil size={16} strokeWidth={1.9} aria-hidden="true" />
                              </button>
                            ) : (
                              <span
                                className="dts-reload-status-text"
                                title={
                                  dtsReloadBlockReasonLabels[
                                    candidate.blockReason ?? "unsupported-value-shape"
                                  ]
                                }
                              >
                                {
                                  dtsReloadBlockReasonLabels[
                                    candidate.blockReason ?? "unsupported-value-shape"
                                  ]
                                }
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
                </div>
              </section>
            </div>
          </div>
        </section>

        {run ? (
          <section className="debug-table dts-reload-run-result" aria-live="polite">
            <div className="panel-header">
              <strong>运行结果</strong>
              <span className={cn("dts-reload-status-pill", statusBadgeClass(run.status))}>
                {dtsReloadStatusLabels[run.status]}
              </span>
            </div>
            <div className="dts-reload-run-result__body">
              {run.failureCode ||
              run.purpose === "restore-baseline" ||
              run.bridgeMachineLabel ||
              run.targetRef ||
              run.targets.length > 0 ||
              run.integrityCheck ? (
                <section className="dts-reload-run-slice" aria-label="运行摘要">
                  <h3 className="dts-reload-run-slice__title">摘要</h3>
                  <dl className="dts-reload-run-summary">
                    {run.failureCode ? (
                      <div className="dts-reload-run-summary__row">
                        <dt>失败码</dt>
                        <dd className="font-mono">{run.failureCode}</dd>
                      </div>
                    ) : null}
                    {run.purpose === "restore-baseline" ? (
                      <div className="dts-reload-run-summary__row">
                        <dt>目的</dt>
                        <dd className="dts-reload-run-purpose">
                          {dtsReloadPurposeLabels["restore-baseline"]}
                          {run.restoresSourceRunId ? `（源运行 ${run.restoresSourceRunId}）` : ""}
                        </dd>
                      </div>
                    ) : null}
                    {run.bridgeMachineLabel || run.targetRef ? (
                      <div className="dts-reload-run-summary__row">
                        <dt>目标设备</dt>
                        <dd>
                          <span className="font-mono">
                            {run.deviceId ?? deviceId} · {run.targetRef ?? targetRef}
                          </span>
                          {run.bridgeMachineLabel ? ` · Bridge ${run.bridgeMachineLabel}` : ""}
                          {run.purpose === "restore-baseline" ? " · 补偿性恢复基线" : ""}
                        </dd>
                      </div>
                    ) : null}
                    {run.targets.length > 0 ? (
                      <div className="dts-reload-run-summary__row">
                        <dt>参数目标</dt>
                        <dd>本运行包含 {run.targets.length} 个参数目标。</dd>
                      </div>
                    ) : null}
                    {run.integrityCheck ? (
                      <div className="dts-reload-run-summary__row">
                        <dt>完整性校验</dt>
                        <dd>{integrityCheckLabel(run.integrityCheck)}</dd>
                      </div>
                    ) : null}
                  </dl>
                </section>
              ) : null}

              {run.diagnostics.length > 0 ? (
                <section className="dts-reload-run-slice dts-reload-run-slice--danger" aria-label="诊断信息">
                  <h3 className="dts-reload-run-slice__title">诊断</h3>
                  <ul className="dts-reload-diagnostics">
                    {run.diagnostics.map((diagnostic, index) => (
                      <li key={`${diagnostic.code}-${index}`}>{diagnostic.message}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {run.steps.length > 0 ? (
                <section className="dts-reload-run-slice" aria-label="预检步骤">
                  <h3 className="dts-reload-run-slice__title">预检步骤</h3>
                  <RunStepsList steps={run.steps} />
                </section>
              ) : null}

              {run.reloadSnapshot ? (
                <section className="dts-reload-run-slice" aria-label="重载证据">
                  <h3 className="dts-reload-run-slice__title">重载证据</h3>
                  <ReloadSnapshotSummary snapshot={run.reloadSnapshot} />
                </section>
              ) : null}

              {run.overlaySource ? (
                <section className="dts-reload-run-slice">
                  <h3 className="dts-reload-run-slice__title">Overlay 源码</h3>
                  <div className="dts-reload-overlay-source">
                    <textarea aria-label="Overlay 源码" readOnly value={run.overlaySource} />
                  </div>
                </section>
              ) : null}

              {run.artifact || (canRetryDeploy && canStartRun) ? (
                <section className="dts-reload-run-slice dts-reload-run-slice--actions" aria-label="产物与操作">
                  <h3 className="dts-reload-run-slice__title">产物与操作</h3>
                  {run.artifact ? (
                    <div className="dts-reload-artifact">
                      <button
                        type="button"
                        className="button subtle dts-reload-artifact__download"
                        disabled={run.artifactRetentionExpired === true}
                        onClick={() => void onDownload()}
                      >
                        {run.artifactRetentionExpired
                          ? "产物已过期（不可下载）"
                          : `下载编译产物 (${run.artifact.fileName})`}
                      </button>
                      <p className="font-mono">sha256 {run.artifact.sha256}</p>
                    </div>
                  ) : null}
                  {canRetryDeploy && canStartRun ? (
                    <button
                      type="button"
                      className="submit-round-button debugging-deploy-button"
                      disabled={!deployReady || deploying}
                      onClick={() => openDeployConfirm(run)}
                    >
                      {run.status === "failed" ? "重试部署到设备" : "部署到设备"}
                    </button>
                  ) : null}
                </section>
              ) : null}
            </div>
          </section>
        ) : null}

        <details className="operation-history-panel dts-reload-history" aria-label="运行历史">
          <summary id="dts-reload-history-title">
            <strong>运行历史</strong>
            <span>
              {historyLoading
                ? "加载中…"
                : historyItems.length > 0
                  ? `${historyItems.length} 条`
                  : "暂无记录"}
            </span>
          </summary>
          <div className="dts-reload-history__body">
            <p className="dts-reload-history__hint">
              按项目列出（可选设备过滤），含已阻断与失败运行；恢复基线运行单独标注。
            </p>
            <label className="dts-reload-history__filter">
              <input
                type="checkbox"
                checked={Boolean(historyFilterDevice && deviceId.trim())}
                disabled={!deviceId.trim()}
                onChange={(event) => {
                  if (!deviceId.trim()) return;
                  setHistoryFilterDevice(event.target.checked);
                }}
                aria-label="仅显示当前设备的运行"
              />
              仅当前设备
              {deviceId.trim() ? `（${deviceId.trim()}）` : "（先填写设备 ID）"}
            </label>
            {historyError ? (
              <p role="alert" className="dts-reload-history__error">
                {historyError}
              </p>
            ) : null}
            {historyLoading ? (
              <p>加载运行历史…</p>
            ) : historyItems.length === 0 ? (
              <p>暂无运行记录。</p>
            ) : (
              <ul className="dts-reload-history__list">
                {historyItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={cn(run?.id === item.id && "is-active")}
                      onClick={() => void onOpenHistoryRun(item.id)}
                    >
                      <div className="dts-reload-history__row-head">
                        <span className={cn("dts-reload-status-pill", statusBadgeClass(item.status))}>
                          {dtsReloadStatusLabels[item.status]}
                        </span>
                        {item.purpose === "restore-baseline" ? (
                          <span className="dts-reload-purpose-pill">
                            {dtsReloadPurposeLabels["restore-baseline"]}
                          </span>
                        ) : null}
                        <span>{formatAttemptedAt(item.createdAt)}</span>
                      </div>
                      <div className="dts-reload-history__row-meta">
                        {item.deviceId ?? "未绑定设备"} · {item.targetCount} 个参数
                        {item.propertyKeys.length > 0 ? ` · ${item.propertyKeys.slice(0, 3).join(", ")}` : ""}
                        {item.failureCode ? ` · ${item.failureCode}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {historyNextCursor ? (
              <button
                type="button"
                className="button subtle"
                disabled={historyLoadingMore || historyLoading}
                onClick={() => void onLoadMoreHistory()}
              >
                {historyLoadingMore ? "加载中…" : "加载更多"}
              </button>
            ) : null}
          </div>
        </details>

        {editingCandidate ? (
          <DtsReloadCandidateEditDialog
            candidate={editingCandidate}
            initialDebugValue={
              debugValues[editingCandidate.bindingId] ?? editingCandidate.baselineValue ?? ""
            }
            alreadyInBatch={selectedBindingIds.includes(editingCandidate.bindingId)}
            onClose={() => setEditingBindingId(null)}
            onConfirm={(debugValue) => confirmCandidateDebugValue(editingCandidate, debugValue)}
            onOpenHistoryRun={(runId) => {
              void onOpenHistoryRun(runId);
            }}
          />
        ) : null}

        <ConfirmDialog
          open={deployConfirmOpen}
          title={confirmRun?.purpose === "restore-baseline" ? "确认补偿性恢复基线部署" : "确认部署到设备"}
          description={
            confirmRun ? (
              <DeployConfirmBody
                run={confirmRun}
                deviceId={deviceId.trim()}
                targetRef={targetRef.trim()}
                bridgeMachineLabel={selectedBridge?.machineLabel ?? confirmRun.bridgeMachineLabel ?? "—"}
                residue={residue}
              />
            ) : null
          }
          confirmLabel={confirmRun?.purpose === "restore-baseline" ? "确认补偿性部署" : "确认部署"}
          tone="danger"
          pending={deploying}
          pendingLabel="部署中…"
          error={
            deployError ? (
              <span className="flex flex-col gap-2">
                <span>{deployError}</span>
                {deployUpgradeReleasesPath ? (
                  <span>
                    Bridge 版本过旧或缺少所需 RPC。请{" "}
                    <a className="font-medium underline" href={BRIDGE_UPGRADE_ENTRY_PATH}>
                      下载或升级 Bridge
                    </a>
                    （发布元数据：<code className="rounded bg-rose-100 px-1">{deployUpgradeReleasesPath}</code>）。
                  </span>
                ) : null}
              </span>
            ) : (
              ""
            )
          }
          onCancel={closeDeployConfirm}
          onConfirm={() => void onDeployConfirm()}
        />

        <ConfirmDialog
          open={restoreConfirmOpen}
          title="确认恢复基线（补偿性重载）"
          description={
            residue ? (
              <div className="flex flex-col gap-3 text-sm">
                <p className="text-xs leading-relaxed">
                  将启动一次<strong>新的重载运行</strong>，调试值取自残留产生运行的同一参数集的<strong>库基线值</strong>。
                  这是<strong>补偿性重载</strong>，不是撤销——已应用的 overlay 无法卸载。
                </p>
                <ResidueIndicator residue={residue} deviceId={deviceId.trim()} />
                <p className="text-xs text-muted-foreground">
                  预检、敏感确认与部署确认路径与普通运行完全相同，不会走捷径。
                </p>
                {restoreHasSensitive ? (
                  <p className="text-xs text-amber-950">
                    残留参数含敏感节点匹配；恢复基线仍须具备{" "}
                    {Array.from(
                      new Set(
                        residueSensitiveCandidates
                          .map((candidate) => candidate.sensitiveMatch?.requiredCapability)
                          .filter((value): value is string => Boolean(value))
                      )
                    ).join(" / ") || "parameter:edit-critical"}
                    。
                  </p>
                ) : null}
                {restoreHasCriticalSensitive ? (
                  <label className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-950">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={restoreCriticalConfirmed}
                      onChange={(event) => setRestoreCriticalConfirmed(event.target.checked)}
                      aria-label="确认 critical 敏感节点补偿性恢复"
                    />
                    <span>
                      我确认要以库基线值对 critical 敏感参数启动补偿性恢复（confirmationToken=
                      {SENSITIVE_RELOAD_CONFIRMATION_TOKEN}）。这不是撤销。
                    </span>
                  </label>
                ) : null}
              </div>
            ) : null
          }
          confirmLabel="启动补偿性恢复"
          tone="danger"
          pending={restoring}
          pendingLabel="启动中…"
          error={restoreError}
          onCancel={closeRestoreConfirm}
          onConfirm={() => void onRestoreConfirm()}
        />
      </div>
    </div>
  );
}
