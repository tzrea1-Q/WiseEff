import { useEffect, useMemo, useState } from "react";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { DtsReloadCandidate, DtsReloadRun } from "@/domain/dtsReload/types";
import { dtsReloadBlockReasonLabels, SENSITIVE_RELOAD_CONFIRMATION_TOKEN } from "@/domain/dtsReload/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DtsReloadPageProps = {
  projects: Array<{ id: string; name: string }>;
  initialProjectId?: string;
  repository: DtsReloadRepository | null;
  canStartRun: boolean;
  unavailableReason?: string;
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

export function DtsReloadPage({
  projects,
  initialProjectId,
  repository,
  canStartRun,
  unavailableReason
}: DtsReloadPageProps) {
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? "");
  const [candidates, setCandidates] = useState<DtsReloadCandidate[]>([]);
  const [selectedBindingIds, setSelectedBindingIds] = useState<string[]>([]);
  const [debugValues, setDebugValues] = useState<Record<string, string>>({});
  const [run, setRun] = useState<DtsReloadRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [nodeFilter, setNodeFilter] = useState("");
  const [criticalConfirmed, setCriticalConfirmed] = useState(false);

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
              return;
            }
          } catch {
            writeRunIdToSearch(null);
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

  return (
    <section className="dts-reload-page flex flex-col gap-5 p-6" aria-labelledby="dts-reload-title">
      <header className="flex flex-col gap-2">
        <h2 id="dts-reload-title" className="text-xl font-semibold">
          DTS 重载调试
        </h2>
        <p className="text-sm text-muted-foreground">
          一次运行可批量覆盖多个节点的参数（u32 cell 数组与字符串列表）。调试值不会写回参数库。本票停在可下载产物，不触达设备。
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
                {SENSITIVE_RELOAD_CONFIRMATION_TOKEN}）。调试值不会写回参数库；设备部署确认属于后续步骤。
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
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">运行结果</h3>
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs font-medium",
                    run.status === "validated" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950"
                  )}
                >
                  {run.status === "validated" ? "已验证" : "已阻断"}
                </span>
              </div>
              {run.failureCode ? <p className="text-xs text-muted-foreground">失败码：{run.failureCode}</p> : null}
              {run.targets.length > 0 ? (
                <p className="text-xs text-muted-foreground">本运行包含 {run.targets.length} 个参数目标。</p>
              ) : null}
              {run.diagnostics.length > 0 ? (
                <ul className="space-y-1 text-xs text-rose-900">
                  {run.diagnostics.map((diagnostic, index) => (
                    <li key={`${diagnostic.code}-${index}`}>{diagnostic.message}</li>
                  ))}
                </ul>
              ) : null}
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
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
