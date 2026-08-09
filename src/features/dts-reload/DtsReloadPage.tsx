import { useEffect, useMemo, useState } from "react";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { DtsReloadCandidate, DtsReloadRun } from "@/domain/dtsReload/types";
import { dtsReloadBlockReasonLabels } from "@/domain/dtsReload/types";
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

export function DtsReloadPage({
  projects,
  initialProjectId,
  repository,
  canStartRun,
  unavailableReason
}: DtsReloadPageProps) {
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? "");
  const [candidates, setCandidates] = useState<DtsReloadCandidate[]>([]);
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(null);
  const [debugValue, setDebugValue] = useState("");
  const [run, setRun] = useState<DtsReloadRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => candidates.find((candidate) => candidate.bindingId === selectedBindingId) ?? null,
    [candidates, selectedBindingId]
  );

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
      .then((result) => {
        if (cancelled) return;
        setCandidates(result.items);
        const firstDebuggable = result.items.find((item) => item.debuggable);
        setSelectedBindingId(firstDebuggable?.bindingId ?? result.items[0]?.bindingId ?? null);
        setDebugValue(firstDebuggable?.baselineValue ?? "");
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
    if (!query.trim()) return true;
    const haystack = [candidate.displayName, candidate.propertyKey, candidate.module, candidate.nodePath ?? ""]
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(query.trim().toLocaleLowerCase());
  });

  const onSelect = (candidate: DtsReloadCandidate) => {
    setSelectedBindingId(candidate.bindingId);
    setDebugValue(candidate.baselineValue ?? "");
    setErrorMessage("");
  };

  const onStart = async () => {
    if (!selected || !canStartRun) return;
    setStarting(true);
    setErrorMessage("");
    try {
      const started = await repository.startRun({
        projectId,
        bindingId: selected.bindingId,
        debugValue
      });
      setRun(started);
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
          为单个 u32 参数生成并通过预检的调试 overlay。调试值不会写回参数库。本票停在可下载产物，不触达设备。
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
          <span className="font-medium">搜索</span>
          <input
            aria-label="搜索参数"
            className="min-w-[220px] rounded-md border px-3 py-2"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="名称 / 模块 / 路径"
          />
        </label>
      </div>

      {!canStartRun ? (
        <p role="status" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
          缺少 debugging:dts-reload 权限。服务器也会拒绝无权限请求。
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
                <th className="px-3 py-2">参数</th>
                <th className="px-3 py-2">库基线</th>
                <th className="px-3 py-2">约束</th>
                <th className="px-3 py-2">状态</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={4}>
                    加载中…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={4}>
                    当前项目没有可列出的参数。
                  </td>
                </tr>
              ) : (
                filtered.map((candidate) => (
                  <tr
                    key={candidate.bindingId}
                    className={cn(
                      "cursor-pointer border-t hover:bg-muted/30",
                      selectedBindingId === candidate.bindingId && "bg-sky-50"
                    )}
                    onClick={() => onSelect(candidate)}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{candidate.displayName || candidate.propertyKey}</div>
                      <div className="text-xs text-muted-foreground">{candidate.nodePath ?? "无路径"}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{candidate.baselineValue ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{constraintSummary(candidate.constraints)}</td>
                    <td className="px-3 py-2 text-xs">
                      {candidate.debuggable
                        ? "可调试"
                        : dtsReloadBlockReasonLabels[candidate.blockReason ?? "unsupported-value-shape"]}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-4 rounded-md border p-4">
          <h3 className="text-sm font-semibold">启动运行</h3>
          {selected ? (
            <>
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">属性</dt>
                  <dd className="font-mono">{selected.propertyKey}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">库基线</dt>
                  <dd className="font-mono">{selected.baselineValue ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">约束</dt>
                  <dd>{constraintSummary(selected.constraints)}</dd>
                </div>
              </dl>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">调试值</span>
                <input
                  aria-label="调试值"
                  className="rounded-md border px-3 py-2 font-mono"
                  value={debugValue}
                  onChange={(event) => setDebugValue(event.target.value)}
                  disabled={!selected.debuggable || !canStartRun}
                  placeholder="<7000>"
                />
              </label>
              <Button
                type="button"
                onClick={() => void onStart()}
                disabled={!selected.debuggable || !canStartRun || !debugValue.trim() || starting}
              >
                {starting ? "预检中…" : "启动重载运行"}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">选择一个参数以输入调试值。</p>
          )}

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
