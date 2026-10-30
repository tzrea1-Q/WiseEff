import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SelectControl } from "@/components/common/SelectControl";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Input } from "@/components/ui/input";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { CatalogUnregisteredSubjectsResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { createGovernanceIdempotencyKey } from "./governanceState";
import { catalogSubjectTypeLabel } from "@/features/parameter-catalog/catalogPresentation";

export type BatchRegistrationEntry = { subjectIds?: readonly string[]; hints?: Readonly<Record<string, { categoryPath?: string | readonly string[]; moduleName?: string }>> };
type Item = CatalogUnregisteredSubjectsResponse["items"][number];
type Module = CatalogUnregisteredSubjectsResponse["modules"][number];
type RowError = { field: "category" | "name" | "subject"; message: string };
type Row = { subject: Item; selected: boolean; category: string; name: string; moduleId: string; error: RowError | null };
type Props = { repository: Pick<ParameterCatalogGovernanceRepository, "listUnregisteredSubjects" | "createBatchRegistration">;
  organizationId: string; catalogReleaseId: string; initial?: BatchRegistrationEntry; onCompleted?: () => void; onRefreshEvidence?: () => Promise<string>;
  onClose?: () => void };
const mockUnavailable = "模拟模式不支持批量登记，请使用 API 模式。";
const visibleError = (reason: unknown, fallback: string) => reason instanceof WiseEffApiError ? reason.message
  : reason instanceof Error && reason.message === mockUnavailable ? reason.message : fallback;

function pathFor(module: Module, modules: Module[]): string {
  const parts = [module.name];
  const seen = new Set([module.id]);
  let parent = module.parentId;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const next = modules.find((candidate) => candidate.id === parent);
    if (!next) break;
    parts.unshift(next.name);
    parent = next.parentId;
  }
  return parts.join(" / ");
}

export function BatchRegistrationTable({ repository, organizationId, catalogReleaseId, initial, onCompleted, onRefreshEvidence, onClose }: Props) {
  const rowPrefix = useId();
  const [release, setRelease] = useState(catalogReleaseId);
  const [source, setSource] = useState<"organization" | "all">(initial?.subjectIds?.length ? "all" : "organization");
  const [rows, setRows] = useState<Row[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [bulkCategory, setBulkCategory] = useState("");
  const [error, setError] = useState("");
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [evidenceFresh, setEvidenceFresh] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [editedSubjects, setEditedSubjects] = useState<ReadonlySet<string>>(() => new Set());
  const generation = useRef(0);
  const entry = useRef(initial);
  const submitGate = useRef(false);
  const requestKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setEvidenceFresh(false); setError("");
    try {
      if (!repository.listUnregisteredSubjects) throw new Error("无法读取待登记主体。");
      const data = await repository.listUnregisteredSubjects(organizationId, source, release);
      if (current !== generation.current) return;
      if (data.catalogReleaseId !== release) throw new Error("目录版本已变化。");
      const categories = data.modules.filter((module) => module.kind === "business");
      setModules(data.modules);
      setBulkCategory((current) => current === "unclassified" || categories.some((category) => `category:${category.id}` === current) ? current : "");
      const visibleIds = new Set(data.items.map((subject) => subject.id));
      setEditedSubjects((current) => new Set([...current].filter((id) => visibleIds.has(id))));
      setRows((previous) => data.items.map((subject) => {
        const retained = previous.find((row) => row.subject.id === subject.id);
        if (retained) return { ...retained, subject, category: retained.category === "unclassified" || categories.some((item) => `category:${item.id}` === retained.category) ? retained.category : "", error: retained.moduleId && (!subject.availableModuleIds.includes(retained.moduleId) || !data.modules.some((module) => module.id === retained.moduleId && !module.occupied)) ? { field: "subject", message: "目标模块已不可用，请重新选择。" } : null };
        const hint = entry.current?.hints?.[subject.id];
        const hintPath = Array.isArray(hint?.categoryPath) ? hint.categoryPath.join(" / ") : hint?.categoryPath;
        const matches = categories.filter((category) => pathFor(category, data.modules) === hintPath);
        return { subject, selected: entry.current?.subjectIds ? entry.current.subjectIds.includes(subject.id) : source === "organization",
          category: hintPath === "未分类" ? "unclassified" : matches.length === 1 ? `category:${matches[0]!.id}` : "",
          name: hint?.moduleName ?? subject.canonicalName, moduleId: "", error: null };
      }));
      setEvidenceFresh(true);
    } catch (reason) {
      if (current === generation.current) setError(visibleError(reason, "无法读取待登记主体，请重试。"));
    } finally { if (current === generation.current) setLoading(false); }
  }, [release, organizationId, repository, source]);
  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);
  useEffect(() => { setRelease(catalogReleaseId); }, [catalogReleaseId]);
  const refresh = async () => {
    if (!onRefreshEvidence) { await load(); return; }
    setLoading(true); setEvidenceFresh(false);
    try {
      const latest = await onRefreshEvidence();
      if (latest === release) await load(); else setRelease(latest);
    } catch (reason) {
      setLoading(false); setError(visibleError(reason, "无法读取当前目录版本，请重试。"));
    }
  };
  const update = (id: string, change: Partial<Row>) => {
    setEditedSubjects((current) => new Set([...current, id]));
    setRows((current) => current.map((row) => row.subject.id === id ? { ...row, ...change, error: null } : row));
  };
  const requestClose = () => {
    if (pending) return;
    if (editedSubjects.size) setLeaveOpen(true);
    else onClose?.();
  };
  const selected = rows.filter((row) => row.selected);
  const categories = modules.filter((module) => module.kind === "business");
  const options = [{ value: "", label: "请选择业务分类" }, { value: "unclassified", label: "未分类" },
    ...categories.map((category) => ({ value: `category:${category.id}`, label: pathFor(category, modules) }))];
  const categoryLabel = (category: string) => category === "unclassified" ? "未分类" : pathFor(categories.find((item) => `category:${item.id}` === category)!, modules);
  const prepare = () => {
    if (!selected.length) { setError("请选择待登记主体。"); return; }
    if (selected.length > 128) { setError("每批最多登记 128 个主体。"); return; }
    const targetIds = new Set<string>();
    const duplicateTargets = new Set<string>();
    for (const row of selected) if (row.moduleId) {
      if (targetIds.has(row.moduleId)) duplicateTargets.add(row.moduleId);
      targetIds.add(row.moduleId);
    }
    const rowError = (row: Row): RowError | null => {
      if (row.moduleId) {
        if (!row.subject.availableModuleIds.includes(row.moduleId) || !modules.some((module) => module.id === row.moduleId && !module.occupied)) return { field: "subject", message: "目标模块已不可用，请重新选择。" };
        if (duplicateTargets.has(row.moduleId)) return { field: "subject", message: "同一模块不能用于多个主体。" };
        return null;
      }
      return !row.category ? { field: "category", message: "请选择业务分类。" } : !row.name.trim() ? { field: "name", message: "请输入模块名称。" } : null;
    };
    const invalid = selected.some((row) => rowError(row));
    if (invalid) {
      setRows((current) => current.map((row) => !row.selected ? row : { ...row, error: rowError(row) }));
      return;
    }
    setError(""); setConfirm(true);
  };
  const submit = async () => {
    if (submitGate.current) return;
    submitGate.current = true; setPending(true); setSuccessCount(null);
    try {
      if (!repository.createBatchRegistration) throw new Error("无法提交批量登记。");
      const body = { rows: selected.map((row) => ({ subjectId: row.subject.id,
        target: row.moduleId ? { type: "existing-module" as const, moduleId: row.moduleId }
          : row.category === "unclassified" ? { type: "unclassified" as const, name: row.name.trim() }
          : { type: "new-module" as const, parentModuleId: row.category.slice("category:".length), name: row.name.trim() } })) };
      const fingerprint = JSON.stringify([release, body]);
      if (requestKey.current?.fingerprint !== fingerprint) requestKey.current = { fingerprint, key: createGovernanceIdempotencyKey() };
      await repository.createBatchRegistration(organizationId, body, { catalogReleaseId: release, idempotencyKey: requestKey.current.key });
      const submitted = new Set(selected.map((row) => row.subject.id));
      setEditedSubjects((current) => new Set([...current].filter((id) => !submitted.has(id))));
      requestKey.current = null; setConfirm(false); entry.current = undefined; setSuccessCount(selected.length); await load(); onCompleted?.();
    } catch (reason) {
      setConfirm(false); setEvidenceFresh(false);
      const failures = reason instanceof WiseEffApiError && Array.isArray(reason.details.rows) ? reason.details.rows as Array<{ index: number; message: string }> : [];
      if (failures.length) setRows((current) => current.map((row) => {
        const index = selected.findIndex((item) => item.subject.id === row.subject.id);
        const failure = failures.find((item) => item.index === index);
        if (!failure) return row;
        const field = failure.message === "业务分类不存在或不可用。" ? "category"
          : failure.message === "同一分类下已有同名模块。" || failure.message === "请输入有效的模块名称（最多 120 字）。" ? "name" : "subject";
        return { ...row, error: { field, message: failure.message } };
      }));
      setError(failures.length ? "批量登记未完成，请检查各行并重新读取。" : visibleError(reason, "批量登记失败，请重新读取后重试。"));
    } finally { submitGate.current = false; setPending(false); }
  };
  const groups = new Map<string, number>();
  for (const row of selected) {
    const module = row.moduleId ? modules.find((item) => item.id === row.moduleId) : undefined;
    const parent = module && modules.find((item) => item.id === module.parentId);
    const label = module ? parent?.kind === "business" ? pathFor(parent, modules) : "未分类" : row.category ? categoryLabel(row.category) : null;
    if (label) groups.set(label, (groups.get(label) ?? 0) + 1);
  }
  const content = (descriptionId?: string) => <>
    <div id={descriptionId} className="confirm-dialog__scroll"><section aria-label="待登记主体">
    <div className="flex flex-nowrap items-end gap-2"><label>来源<SelectControl ariaLabel="来源" value={source} onValueChange={(value) => { setEvidenceFresh(false); setRows([]); setSource(value); }} options={[
      { value: "organization", label: "本组织发布引入" }, { value: "all", label: "全部 Catalog 主体" }]} /></label>
    <button type="button" className="button subtle" onClick={() => void refresh()} disabled={loading || pending}>重新读取</button></div>
    {loading ? <p>正在读取待登记主体…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {successCount !== null ? <p role="status">已登记 {successCount} 个主体。</p> : null}
    <div className="flex flex-wrap items-end gap-2"><label>批量业务分类<SelectControl ariaLabel="批量业务分类" value={bulkCategory} onValueChange={setBulkCategory} options={options} /></label>
      <button type="button" className="button subtle" disabled={!bulkCategory || !selected.length || loading || pending} onClick={() => {
        setEditedSubjects((current) => new Set([...current, ...selected.map((row) => row.subject.id)]));
        setRows((current) => current.map((row) => row.selected ? { ...row, category: bulkCategory, moduleId: "", error: null } : row));
      }}>设置业务分类</button></div>
    <div className="definition-editor__table-wrap"><table className="definition-editor__table"><thead><tr><th>选择</th><th>主体</th><th>登记目标</th><th>业务分类</th><th>模块名称</th></tr></thead><tbody>
      {rows.map((row) => {
        const errorId = `${rowPrefix}-${row.subject.id}-error`;
        return <tr key={row.subject.id}><td><input type="checkbox" aria-label={`选择 ${row.subject.canonicalName}`} checked={row.selected} onChange={(event) => update(row.subject.id, { selected: event.target.checked })} /></td>
          <td>{row.subject.canonicalName} · {catalogSubjectTypeLabel(row.subject.kind)}{row.error?.field === "subject" ? <p className="field-error" role="alert">{row.error.message}</p> : null}</td>
          <td><SelectControl ariaLabel={`${row.subject.canonicalName} 的登记目标`} value={row.moduleId} onValueChange={(moduleId) => update(row.subject.id, { moduleId })} options={[
            { value: "", label: "新建模块" },
            ...modules.filter((module) => !module.occupied && row.subject.availableModuleIds.includes(module.id)).map((module) => ({ value: module.id, label: pathFor(module, modules), disabled: selected.some((other) => other.subject.id !== row.subject.id && other.moduleId === module.id) })),
            ...(row.moduleId && (!row.subject.availableModuleIds.includes(row.moduleId) || !modules.some((module) => module.id === row.moduleId && !module.occupied)) ? [{ value: row.moduleId, label: "目标模块已不可用", hidden: true }] : []),
          ]} /></td>
          <td><SelectControl ariaLabel={`${row.subject.canonicalName} 的业务分类`} value={row.category} onValueChange={(category) => update(row.subject.id, { category })} options={options} disabled={!!row.moduleId}
            ariaInvalid={row.error?.field === "category"} ariaDescribedBy={row.error?.field === "category" ? errorId : undefined} />
            {row.error?.field === "category" ? <p id={errorId} className="field-error" role="alert">{row.error.message}</p> : null}</td>
          <td><Input aria-label={`${row.subject.canonicalName} 的模块名称`} value={row.name} onChange={(event) => update(row.subject.id, { name: event.target.value })} disabled={!!row.moduleId}
            aria-invalid={row.error?.field === "name"} aria-describedby={row.error?.field === "name" ? errorId : undefined} />
            {row.error?.field === "name" ? <p id={errorId} className="field-error" role="alert">{row.error.message}</p> : null}</td></tr>;
      })}
      {!loading && !rows.length && !error ? <tr><td colSpan={5}>{source === "organization" ? "本组织发布引入的主体都已登记。可切换来源查看全部 Catalog 主体。" : "当前目录中没有待登记主体。"}</td></tr> : null}
    </tbody></table></div>
    </section></div>
    <div className="dialog-actions">{onClose ? <button type="button" className="button subtle" onClick={requestClose} disabled={pending}>关闭</button> : null}
      <button type="button" className="button primary" onClick={prepare} disabled={loading || pending || !evidenceFresh || !selected.length}>继续确认（{selected.length}）</button></div>
    <ConfirmDialog open={confirm} title="确认批量登记" confirmLabel="确认登记" pending={pending} onCancel={() => setConfirm(false)} onConfirm={() => void submit()}
      description={<><p>登记 {selected.length} 个主体，新建 {selected.filter((row) => !row.moduleId).length} 个模块。</p>{[...groups].map(([name, count]) => <p key={name}>{name}：{count} 个</p>)}</>} />
    <ConfirmDialog open={leaveOpen} title="放弃未保存的登记修改？" description="关闭将丢失当前选择、业务分类和模块名称。"
      confirmLabel="放弃修改" cancelLabel="继续编辑" onConfirm={() => { setLeaveOpen(false); onClose?.(); }} onCancel={() => setLeaveOpen(false)} />
  </>;
  return onClose ? <ModalDialog open onDismiss={pending ? undefined : requestClose}
    className="confirm-dialog governance-confirm-dialog parameter-catalog__pending-dialog review-workbench-dialog" describedBy>
    {({ titleId, descriptionId }) => <><h2 id={titleId}>待登记主体</h2>{content(descriptionId)}</>}
  </ModalDialog> : content();
}
