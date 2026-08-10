import { useEffect, useMemo, useState } from "react";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import {
  dtsReloadBlockReasonLabels,
  dtsReloadStatusLabels,
  dtsReloadVerificationOutcomeLabels,
  DTS_RELOAD_CONFIRMATION_TOKEN,
  SENSITIVE_RELOAD_CONFIRMATION_TOKEN
} from "@/domain/dtsReload/types";
import type {
  DtsReloadCandidate,
  DtsReloadIntegrityCheck,
  DtsReloadParameterVerification,
  DtsReloadRun,
  DtsReloadSnapshot
} from "@/domain/dtsReload/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { listMyBridges } from "@/infrastructure/http/deviceBridgeClient";
import { cn } from "@/lib/utils";

export type DtsReloadPageProps = {
  projects: Array<{ id: string; name: string }>;
  initialProjectId?: string;
  repository: DtsReloadRepository | null;
  canStartRun: boolean;
  unavailableReason?: string;
  bridges?: Array<{ id: string; machineLabel: string }>;
  listBridges?: () => Promise<Array<{ id: string; machineLabel: string }>>;
};

type BridgeOption = { id: string; machineLabel: string };
type DeployProtocol = "hdc" | "adb";

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

function constraintSummary(constraints: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof constraints.min === "number") parts.push(`min ${constraints.min}`);
  if (typeof constraints.max === "number") parts.push(`max ${constraints.max}`);
  if (typeof constraints.cells === "number") parts.push(`cells ${constraints.cells}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function sensitiveBadgeLabel(candidate: DtsReloadCandidate): string | null {
  const match = candidate.sensitiveMatch;
  if (!match) return null;
  return match.riskTier === "critical" ? "敏感 · critical" : "敏感 · high";
}

function parseCellIntegers(raw: string): number[] | null {
  const trimmed = raw.trim();
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

function looksLikeStringList(raw: string): boolean {
  return /"(?:\\.|[^"\\])*"/.test(raw.trim());
}

function validateDebugValueAgainstConstraints(
  raw: string,
  candidate: DtsReloadCandidate
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "请输入调试值。";

  if (candidate.valueShapeKind === "string-list") {
    if (!looksLikeStringList(trimmed)) {
      return '调试值必须是字符串列表，例如 "okay" 或 "a", "b"。';
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
                <p className="text-amber-900">采集文本已按字节上限截断。</p>
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
                <p className="text-muted-foreground">已采集到内核日志，但没有匹配到本运行参数名的行。</p>
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
    <ol className="space-y-1 text-xs" aria-label="运行步骤">
      {steps.map((step, index) => (
        <li key={`${step.step}-${index}`} className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{dtsReloadStepLabels[step.step] ?? step.step}</span>
          <span className={cn("font-medium", stepOutcomeClass(step.outcome))}>
            {dtsReloadStepOutcomeLabels[step.outcome] ?? step.outcome}
          </span>
          {step.error ? <span className="text-rose-900">{step.error}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function DeployConfirmBody({
  run,
  deviceId,
  targetRef,
  bridgeMachineLabel
}: {
  run: DtsReloadRun;
  deviceId: string;
  targetRef: string;
  bridgeMachineLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
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
          <p className="mb-1 text-xs font-medium">参数变更</p>
          <ul className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-2 text-xs">
            {run.targets.map((target) => (
              <li key={target.bindingId}>
                <div className="font-medium">{target.propertyKey}</div>
                <div className="font-mono text-muted-foreground">{target.nodePath}</div>
                <div className="font-mono">
                  {target.baselineValue ?? "—"} → {target.debugValue}
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

export function DtsReloadPage({
  projects,
  initialProjectId,
  repository,
  canStartRun,
  unavailableReason,
  bridges: bridgesProp,
  listBridges
}: DtsReloadPageProps) {
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
  const [nameQuery, setNameQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [nodeFilter, setNodeFilter] = useState("");
  const [criticalConfirmed, setCriticalConfirmed] = useState(false);
  const [bridges, setBridges] = useState<BridgeOption[]>(bridgesProp ?? []);
  const [bridgesLoading, setBridgesLoading] = useState(false);
  const [bridgeId, setBridgeId] = useState("");
  const [targetRef, setTargetRef] = useState("");
  const [protocol, setProtocol] = useState<DeployProtocol>("hdc");
  const [deviceId, setDeviceId] = useState("");
  const [deviceIdTouched, setDeviceIdTouched] = useState(false);
  const [deployConfirmOpen, setDeployConfirmOpen] = useState(false);
  const [pendingDeployRun, setPendingDeployRun] = useState<DtsReloadRun | null>(null);

  const selectedBridge = useMemo(
    () => bridges.find((bridge) => bridge.id === bridgeId) ?? null,
    [bridges, bridgeId]
  );

  const modules = useMemo(
    () =>
      Array.from(new Set(candidates.map((candidate) => candidate.module).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [candidates]
  );

  const nodes = useMemo(
    () =>
      Array.from(
        new Set(candidates.map((candidate) => candidate.nodePath).filter((value): value is string => Boolean(value)))
      ).sort((a, b) => a.localeCompare(b)),
    [candidates]
  );

  const selectedCandidates = useMemo(
    () =>
      selectedBindingIds
        .map((bindingId) => candidates.find((candidate) => candidate.bindingId === bindingId))
        .filter((candidate): candidate is DtsReloadCandidate => Boolean(candidate)),
    [candidates, selectedBindingIds]
  );

  const selectedHasCriticalSensitive = selectedCandidates.some(
    (candidate) => candidate.sensitiveMatch?.riskTier === "critical"
  );
  const selectedHasSensitive = selectedCandidates.some((candidate) => Boolean(candidate.sensitiveMatch));

  const deployReady = Boolean(bridgeId.trim() && targetRef.trim() && deviceId.trim());

  useEffect(() => {
    if (bridgesProp) {
      setBridges(bridgesProp);
    }
  }, [bridgesProp]);

  useEffect(() => {
    if (!repository || bridgesProp) return;
    let cancelled = false;
    setBridgesLoading(true);
    const load = listBridges ?? (() => listMyBridges().then((items) => items.map((item) => ({ id: item.id, machineLabel: item.machineLabel }))));
    void load()
      .then((items) => {
        if (!cancelled) setBridges(items);
      })
      .catch(() => {
        if (!cancelled) setBridges([]);
      })
      .finally(() => {
        if (!cancelled) setBridgesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repository, bridgesProp, listBridges]);

  useEffect(() => {
    if (!bridgeId && bridges.length > 0) {
      setBridgeId(bridges[0]!.id);
    }
  }, [bridgeId, bridges]);

  useEffect(() => {
    if (!bridgeId || deviceIdTouched) return;
    setDeviceId(defaultDeviceId(bridgeId));
  }, [bridgeId, deviceIdTouched]);

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
        // DEV-only visual QA hooks for playwright-cli screenshots (#286 / #287).
        if (import.meta.env.DEV && typeof window !== "undefined") {
          const preview = new URLSearchParams(window.location.search).get("uiPreview");
          if (preview === "kernel-signal" || preview === "behavioural-verify") {
            const verifiedPreview = preview === "behavioural-verify";
            setRun({
              id: "preview-run",
              projectId,
              configRevisionId: null,
              status: verifiedPreview ? "verified" : "unverifiable",
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
    setDeployConfirmOpen(true);
  };

  const closeDeployConfirm = () => {
    if (deploying) return;
    setDeployConfirmOpen(false);
    setPendingDeployRun(null);
    setDeployError("");
  };

  const onDeployConfirm = async () => {
    const deployRun = pendingDeployRun ?? (run?.status === "validated" || run?.status === "failed" ? run : null);
    if (!deployRun || !deployReady) return;

    setDeploying(true);
    setDeployError("");
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
    } catch (error) {
      setDeployError(error instanceof Error ? error.message : "部署到设备失败。");
    } finally {
      setDeploying(false);
    }
  };

  if (!repository) {
    return (
      <section className="dts-reload-page flex flex-col gap-4 p-6" aria-labelledby="dts-reload-unavailable-title">
        <h2 id="dts-reload-unavailable-title" className="text-xl font-semibold">
          DTS 重载调试
        </h2>
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {unavailableReason ?? "该页面仅在 API 模式下可用。Mock 运行时不提供 DTS 重载调试。"}
        </p>
      </section>
    );
  }

  const filtered = candidates.filter((candidate) => {
    if (moduleFilter && candidate.module !== moduleFilter) return false;
    if (nodeFilter && candidate.nodePath !== nodeFilter) return false;
    if (!nameQuery.trim()) return true;
    const haystack = [candidate.displayName, candidate.propertyKey].join(" ").toLocaleLowerCase();
    return haystack.includes(nameQuery.trim().toLocaleLowerCase());
  });

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

  const onStart = async () => {
    if (!canStartRun || selectedCandidates.length === 0) return;

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
        setErrorMessage("预检已通过。填写 Bridge / targetRef / deviceId 后可点击「确认部署到设备」。");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "启动重载运行失败。");
    } finally {
      setStarting(false);
    }
  };

  const onDownload = async () => {
    if (!run?.artifact) return;
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

  const confirmRun = pendingDeployRun ?? run;
  const canRetryDeploy = run?.status === "validated" || run?.status === "failed";

  return (
    <section className="dts-reload-page flex flex-col gap-5 p-6" aria-labelledby="dts-reload-title">
      <header className="flex flex-col gap-2">
        <h2 id="dts-reload-title" className="text-xl font-semibold">
          DTS 重载调试
        </h2>
        <p className="text-sm text-muted-foreground">
          一次运行可批量覆盖多个节点的参数（u32 cell 数组与字符串列表）。调试值不会写回参数库。预检通过后可确认部署到设备。
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">项目</span>
          <select
            aria-label="选择项目"
            className="min-w-[220px] rounded-md border px-3 py-2"
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
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">按名称搜索</span>
          <input
            aria-label="按名称搜索参数"
            className="min-w-[180px] rounded-md border px-3 py-2"
            value={nameQuery}
            onChange={(event) => setNameQuery(event.target.value)}
            placeholder="显示名 / 属性键"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">按模块筛选</span>
          <select
            aria-label="按模块筛选"
            className="min-w-[160px] rounded-md border px-3 py-2"
            value={moduleFilter}
            onChange={(event) => setModuleFilter(event.target.value)}
          >
            <option value="">全部模块</option>
            {modules.map((module) => (
              <option key={module} value={module}>
                {module}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">按节点筛选</span>
          <select
            aria-label="按节点筛选"
            className="min-w-[220px] max-w-[320px] rounded-md border px-3 py-2"
            value={nodeFilter}
            onChange={(event) => setNodeFilter(event.target.value)}
          >
            <option value="">全部节点</option>
            {nodes.map((nodePath) => (
              <option key={nodePath} value={nodePath}>
                {nodePath}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!canStartRun ? (
        <p role="status" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
          当前账号没有 DTS 重载调试权限。服务器也会拒绝无权限请求。
        </p>
      ) : null}

      {errorMessage ? (
        <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
          {errorMessage}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">选择</th>
                <th className="px-3 py-2">参数</th>
                <th className="px-3 py-2">模块</th>
                <th className="px-3 py-2">库基线</th>
                <th className="px-3 py-2">治理</th>
                <th className="px-3 py-2">状态</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={6}>
                    加载中…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={6}>
                    当前筛选条件下没有可列出的参数。
                  </td>
                </tr>
              ) : (
                filtered.map((candidate) => {
                  const selected = selectedBindingIds.includes(candidate.bindingId);
                  const sensitiveLabel = sensitiveBadgeLabel(candidate);
                  return (
                    <tr
                      key={candidate.bindingId}
                      className={cn(
                        "border-t",
                        candidate.debuggable ? "cursor-pointer hover:bg-muted/30" : "opacity-80",
                        selected && "bg-sky-50"
                      )}
                      onClick={() => toggleSelected(candidate)}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`选择 ${candidate.displayName || candidate.propertyKey}`}
                          checked={selected}
                          disabled={!candidate.debuggable}
                          onChange={() => toggleSelected(candidate)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{candidate.displayName || candidate.propertyKey}</div>
                        <div className="text-xs text-muted-foreground">{candidate.nodePath ?? "无路径"}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{candidate.module || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{candidate.baselineValue ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {sensitiveLabel ? (
                          <span
                            className={cn(
                              "inline-flex rounded-md px-2 py-0.5 font-medium",
                              candidate.sensitiveMatch?.riskTier === "critical"
                                ? "bg-rose-100 text-rose-950"
                                : "bg-amber-100 text-amber-950"
                            )}
                            title={
                              candidate.sensitiveMatch
                                ? `需要 ${candidate.sensitiveMatch.requiredCapability}${
                                    candidate.sensitiveMatch.requiresConfirmation
                                      ? "，并需明确确认"
                                      : ""
                                  }`
                                : undefined
                            }
                          >
                            {sensitiveLabel}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {candidate.debuggable
                          ? "可调试"
                          : dtsReloadBlockReasonLabels[candidate.blockReason ?? "unsupported-value-shape"]}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-4 rounded-md border p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">启动运行</h3>
            <span className="text-xs text-muted-foreground">已选 {selectedCandidates.length} 个参数</span>
          </div>

          {selectedCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">勾选一个或多个可调试参数以输入调试值。</p>
          ) : (
            <ul className="flex max-h-[360px] flex-col gap-3 overflow-y-auto">
              {selectedCandidates.map((candidate) => {
                const sensitiveLabel = sensitiveBadgeLabel(candidate);
                return (
                <li key={candidate.bindingId} className="rounded-md border p-3">
                  <div className="mb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium">{candidate.displayName || candidate.propertyKey}</div>
                      {sensitiveLabel ? (
                        <span
                          className={cn(
                            "rounded-md px-2 py-0.5 text-xs font-medium",
                            candidate.sensitiveMatch?.riskTier === "critical"
                              ? "bg-rose-100 text-rose-950"
                              : "bg-amber-100 text-amber-950"
                          )}
                        >
                          {sensitiveLabel}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{candidate.nodePath}</div>
                    <div className="text-xs text-muted-foreground">
                      基线 {candidate.baselineValue ?? "—"} · {constraintSummary(candidate.constraints)}
                    </div>
                    {candidate.sensitiveMatch ? (
                      <p className="mt-1 text-xs text-amber-950">
                        需要 {candidate.sensitiveMatch.requiredCapability}
                        {candidate.sensitiveMatch.requiresConfirmation ? "，并需明确确认" : ""}
                      </p>
                    ) : null}
                  </div>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">调试值</span>
                    <input
                      aria-label={`${candidate.displayName || candidate.propertyKey} 调试值`}
                      className="rounded-md border px-3 py-2 font-mono"
                      value={debugValues[candidate.bindingId] ?? ""}
                      onChange={(event) =>
                        setDebugValues((values) => ({
                          ...values,
                          [candidate.bindingId]: event.target.value
                        }))
                      }
                      disabled={!canStartRun}
                      placeholder={candidate.valueShapeKind === "string-list" ? '"okay"' : "<7000>"}
                    />
                  </label>
                </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
            <h4 className="text-sm font-semibold">设备部署</h4>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Bridge</span>
              <select
                aria-label="选择 Bridge"
                className="rounded-md border px-3 py-2"
                value={bridgeId}
                disabled={!canStartRun || bridgesLoading}
                onChange={(event) => {
                  setBridgeId(event.target.value);
                  setDeviceIdTouched(false);
                }}
              >
                {bridges.length === 0 ? (
                  <option value="">{bridgesLoading ? "加载 Bridge…" : "暂无可用 Bridge"}</option>
                ) : (
                  bridges.map((bridge) => (
                    <option key={bridge.id} value={bridge.id}>
                      {bridge.machineLabel}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">目标标识 (targetRef)</span>
              <input
                aria-label="目标标识 targetRef"
                className="rounded-md border px-3 py-2 font-mono"
                value={targetRef}
                disabled={!canStartRun}
                onChange={(event) => setTargetRef(event.target.value)}
                placeholder="设备序列号或连接标识"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">协议</span>
                <select
                  aria-label="部署协议"
                  className="rounded-md border px-3 py-2"
                  value={protocol}
                  disabled={!canStartRun}
                  onChange={(event) => setProtocol(event.target.value as DeployProtocol)}
                >
                  <option value="hdc">HDC</option>
                  <option value="adb">ADB</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">deviceId</span>
                <input
                  aria-label="deviceId"
                  className="rounded-md border px-3 py-2 font-mono"
                  value={deviceId}
                  disabled={!canStartRun}
                  onChange={(event) => {
                    setDeviceIdTouched(true);
                    setDeviceId(event.target.value);
                  }}
                  placeholder="bridge:..."
                />
              </label>
            </div>
          </div>

          {selectedHasSensitive ? (
            <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              已选参数命中敏感节点规则：除 debugging:dts-reload 外还需要{" "}
              {Array.from(
                new Set(
                  selectedCandidates
                    .map((candidate) => candidate.sensitiveMatch?.requiredCapability)
                    .filter((value): value is string => Boolean(value))
                )
              ).join(" / ") || "parameter:edit-critical"}
              。
              {selectedHasCriticalSensitive ? " critical 层级还需在下方明确确认。" : ""}
            </p>
          ) : null}

          {selectedHasCriticalSensitive ? (
            <label className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-950">
              <input
                type="checkbox"
                className="mt-1"
                checked={criticalConfirmed}
                onChange={(event) => setCriticalConfirmed(event.target.checked)}
                aria-label="确认 critical 敏感节点重载"
              />
              <span>
                我确认要为 critical 敏感参数启动重载运行（发送 confirmationToken=
                {SENSITIVE_RELOAD_CONFIRMATION_TOKEN}）。调试值不会写回参数库；设备部署需另行确认。
              </span>
            </label>
          ) : null}

          <Button
            type="button"
            onClick={() => void onStart()}
            disabled={
              selectedCandidates.length === 0 ||
              !canStartRun ||
              starting ||
              (selectedHasCriticalSensitive && !criticalConfirmed)
            }
          >
            {starting ? "预检中…" : `启动重载运行（${selectedCandidates.length}）`}
          </Button>

          {run ? (
            <div className="flex flex-col gap-3 border-t pt-4" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">运行结果</h3>
                <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", statusBadgeClass(run.status))}>
                  {dtsReloadStatusLabels[run.status]}
                </span>
              </div>
              {run.failureCode ? <p className="text-xs text-muted-foreground">失败码：{run.failureCode}</p> : null}
              {run.bridgeMachineLabel || run.targetRef ? (
                <p className="text-xs text-muted-foreground">
                  目标设备：{run.deviceId ?? deviceId} · {run.targetRef ?? targetRef}
                  {run.bridgeMachineLabel ? ` · Bridge ${run.bridgeMachineLabel}` : ""}
                </p>
              ) : null}
              {run.targets.length > 0 ? (
                <p className="text-xs text-muted-foreground">本运行包含 {run.targets.length} 个参数目标。</p>
              ) : null}
              {run.integrityCheck ? (
                <p className="text-xs text-muted-foreground">
                  完整性校验：{integrityCheckLabel(run.integrityCheck)}
                </p>
              ) : null}
              {run.diagnostics.length > 0 ? (
                <ul className="space-y-1 text-xs text-rose-900">
                  {run.diagnostics.map((diagnostic, index) => (
                    <li key={`${diagnostic.code}-${index}`}>{diagnostic.message}</li>
                  ))}
                </ul>
              ) : null}
              <RunStepsList steps={run.steps} />
              {run.reloadSnapshot ? <ReloadSnapshotSummary snapshot={run.reloadSnapshot} /> : null}
              {run.overlaySource ? (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Overlay 源码</span>
                  <textarea
                    aria-label="Overlay 源码"
                    className="min-h-[220px] rounded-md border bg-muted/20 p-3 font-mono text-xs"
                    readOnly
                    value={run.overlaySource}
                  />
                </label>
              ) : null}
              {run.artifact ? (
                <Button type="button" variant="outline" onClick={() => void onDownload()}>
                  下载编译产物 ({run.artifact.fileName})
                </Button>
              ) : null}
              {canRetryDeploy && canStartRun ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!deployReady || deploying}
                  onClick={() => openDeployConfirm(run)}
                >
                  {run.status === "failed" ? "重试部署到设备" : "部署到设备"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={deployConfirmOpen}
        title="确认部署到设备"
        description={
          confirmRun ? (
            <DeployConfirmBody
              run={confirmRun}
              deviceId={deviceId.trim()}
              targetRef={targetRef.trim()}
              bridgeMachineLabel={selectedBridge?.machineLabel ?? confirmRun.bridgeMachineLabel ?? "—"}
            />
          ) : null
        }
        confirmLabel="确认部署"
        tone="danger"
        pending={deploying}
        pendingLabel="部署中…"
        error={deployError}
        onCancel={closeDeployConfirm}
        onConfirm={() => void onDeployConfirm()}
      />
    </section>
  );
}
