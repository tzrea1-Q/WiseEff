import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SelectControl } from "@/components/common/SelectControl";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/common/SearchField";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { CatalogUnregisteredSubjectsResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { createGovernanceIdempotencyKey } from "./governanceState";
import { catalogSubjectTypeLabel } from "@/features/parameter-catalog/catalogPresentation";
import { modulePathSegments } from "@/components/admin/moduleManagementTreeUtils";
import { catalogFailureReason } from "@/infrastructure/http/parameterCatalogClient";
import { catalogErrorCopy } from "@/features/parameter-catalog/copy";
import "./batch-registration.css";

export type BatchRegistrationEntry = { subjectIds?: readonly string[]; hints?: Readonly<Record<string, { categoryPath?: string | readonly string[]; displayAlias?: string }>> };
type Item = CatalogUnregisteredSubjectsResponse["items"][number];
type Module = CatalogUnregisteredSubjectsResponse["modules"][number];
type RowError = { field: "category" | "name" | "subject"; message: string };
type Row = { subject: Item; selected: boolean; inBatch: boolean; displayAlias: string; moduleId: string; error: RowError | null };
type Props = { repository: Pick<ParameterCatalogGovernanceRepository, "listUnregisteredSubjects" | "createBatchRegistration">;
  organizationId: string; catalogReleaseId: string; initial?: BatchRegistrationEntry; onCompleted?: () => void; onRefreshEvidence?: () => Promise<string>;
  onClose?: () => void };
const rowCopy: Record<string, RowError> = {
  "category-missing": { field: "category", message: "业务分类不存在或不可用。" },
  "name-invalid": { field: "name", message: "请输入有效的展示别名（最多 128 字）。" },
  "already-registered": { field: "subject", message: "主体已登记，请刷新。" },
  "subject-inactive": { field: "subject", message: "主体在当前目录中未生效。" },
  "owned-child": { field: "subject", message: "请登记其所属驱动。" },
  "release-drift": { field: "subject", message: "目录版本已变化，请刷新。" },
  conflict: { field: "subject", message: "登记失败，请刷新后重试。" },
};
const visibleError = (error: unknown, fallback: string) => {
  if (!(error instanceof WiseEffApiError)) return fallback;
  if (error.details.reason === "mock-batch-unavailable") return "模拟模式不支持批量登记，请使用 API 模式。";
  const reason = catalogFailureReason(error);
  return reason === "unknown" ? fallback : catalogErrorCopy(reason);
};

export function BatchRegistrationTable({ repository, organizationId, catalogReleaseId, initial, onCompleted, onRefreshEvidence, onClose }: Props) {
  const rowPrefix = useId();
  const [release, setRelease] = useState(catalogReleaseId);
  const [source, setSource] = useState<"organization" | "all">("organization");
  const [rows, setRows] = useState<Row[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [bulkCategory, setBulkCategory] = useState("");
  const [search, setSearch] = useState("");
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
  const checkInitialSource = useRef(Boolean(initial?.subjectIds?.length));
  const submitGate = useRef(false);
  const requestKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setEvidenceFresh(false); setError("");
    try {
      const data = await repository.listUnregisteredSubjects(organizationId, source, release);
      if (current !== generation.current) return;
      if (data.catalogReleaseId !== release) throw new Error("目录版本已变化。");
      if (source === "organization" && checkInitialSource.current) {
        checkInitialSource.current = false;
        if (entry.current?.subjectIds?.some((id) => !data.items.some((subject) => subject.id === id))) {
          setSource("all");
          return;
        }
      }
      const categories = data.modules.filter((module) => module.kind === "business");
      setModules(data.modules);
      setBulkCategory((current) => current === "unclassified" || categories.some((category) => `category:${category.id}` === current) ? current : "");
      const visibleIds = new Set(data.items.map((subject) => subject.id));
      setEditedSubjects((current) => new Set([...current].filter((id) => visibleIds.has(id))));
      setRows((previous) => data.items.map((subject) => {
        const retained = previous.find((row) => row.subject.id === subject.id);
        if (retained) return { ...retained, subject, error: retained.moduleId && (!subject.availableModuleIds.includes(retained.moduleId) || !data.modules.some((module) => module.id === retained.moduleId)) ? { field: "subject", message: "目标模块已不可用，请重新选择。" } : null };
        const hint = entry.current?.hints?.[subject.id];
        const hintPath = Array.isArray(hint?.categoryPath) ? hint.categoryPath.join(" / ") : hint?.categoryPath;
        const matches = categories.filter((category) => modulePathSegments(category, data.modules).join(" / ") === hintPath);
        const inBatch = entry.current?.subjectIds ? entry.current.subjectIds.includes(subject.id) : source === "organization";
        const hinted = hintPath === "未分类" ? data.modules.find((module) => module.kind === "unclassified" && module.parentId === null)
          : matches.length === 1 ? matches[0] : undefined;
        return { subject, selected: inBatch, inBatch, displayAlias: hint?.displayAlias ?? "",
          moduleId: hinted && subject.availableModuleIds.includes(hinted.id) ? hinted.id : "", error: null };
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
  const batch = rows.filter((row) => row.inBatch);
  const query = search.trim().toLocaleLowerCase();
  const visibleRows = rows.filter(row => `${row.subject.canonicalName} ${row.displayAlias} ${catalogSubjectTypeLabel(row.subject.kind)}`.toLocaleLowerCase().includes(query));
  const categories = modules.filter((module) => module.kind === "business");
  const options = [{ value: "", label: "请选择业务分类" }, { value: "unclassified", label: "未分类" },
    ...categories.map((category) => ({ value: `category:${category.id}`, label: modulePathSegments(category, modules).join(" / ") }))];
  const prepare = () => {
    if (!batch.length) { setError("请选择待登记主体。"); return; }
    if (batch.length > 128) { setError("每批最多登记 128 个主体。"); return; }
    const rowError = (row: Row): RowError | null => {
      if (/[\u0000-\u001f\u007f-\u009f]/u.test(row.displayAlias) || Array.from(row.displayAlias.trim()).length > 128) return rowCopy["name-invalid"]!;
      if (row.moduleId) {
        if (!row.subject.availableModuleIds.includes(row.moduleId) || !modules.some((module) => module.id === row.moduleId
          && (module.kind === "business" || (module.kind === "unclassified" && module.parentId === null)))) return { field: "subject", message: "目标模块已不可用，请重新选择。" };
        return null;
      }
      return { field: "category", message: "请选择业务分类。" };
    };
    const invalid = batch.some((row) => rowError(row));
    if (invalid) {
      setSearch("");
      setRows((current) => current.map((row) => !row.inBatch ? row : { ...row, error: rowError(row) }));
      return;
    }
    setError(""); setConfirm(true);
  };
  const submit = async () => {
    if (submitGate.current) return;
    submitGate.current = true; setPending(true); setSuccessCount(null);
    try {
      const body = { rows: batch.map((row) => ({ subjectId: row.subject.id,
        target: { type: "existing-module" as const, moduleId: row.moduleId },
        ...(row.displayAlias.trim() ? { displayAlias: row.displayAlias.trim() } : {}) })) };
      const fingerprint = JSON.stringify([release, body]);
      if (requestKey.current?.fingerprint !== fingerprint) requestKey.current = { fingerprint, key: createGovernanceIdempotencyKey() };
      await repository.createBatchRegistration(organizationId, body, { catalogReleaseId: release, idempotencyKey: requestKey.current.key });
      const submitted = new Set(batch.map((row) => row.subject.id));
      setEditedSubjects((current) => new Set([...current].filter((id) => !submitted.has(id))));
      requestKey.current = null; setConfirm(false); entry.current = undefined; setSuccessCount(batch.length); await load(); onCompleted?.();
    } catch (reason) {
      setConfirm(false); setEvidenceFresh(false);
      const failures = reason instanceof WiseEffApiError && Array.isArray(reason.details.rows) ? reason.details.rows as Array<{ index: number; code: string }> : [];
      if (failures.length) setRows((current) => current.map((row) => {
        const index = batch.findIndex((item) => item.subject.id === row.subject.id);
        const failure = failures.find((item) => item.index === index);
        if (!failure) return row;
        return { ...row, error: rowCopy[failure.code] ?? rowCopy.conflict! };
      }));
      setError(failures.length ? "批量登记未完成，请检查各行并重新读取。" : visibleError(reason, "批量登记失败，请重新读取后重试。"));
    } finally { submitGate.current = false; setPending(false); }
  };
  const groups = new Map<string, number>();
  for (const row of batch) {
    const module = modules.find((item) => item.id === row.moduleId);
    const label = module ? modulePathSegments(module, modules).join(" / ") : null;
    if (label) groups.set(label, (groups.get(label) ?? 0) + 1);
  }
  const content = (descriptionId?: string) => <>
    <div id={descriptionId} className="confirm-dialog__scroll"><section aria-label="待登记主体" className="batch-registration">
    <p className="muted">为待登记主体选择业务分类，再确认本次登记范围。每批最多登记 128 个主体。</p>
    <div className="batch-registration__toolbar"><label>来源<SelectControl ariaLabel="来源" value={source} disabled={loading || pending} onValueChange={(value) => { checkInitialSource.current = false; setEvidenceFresh(false); setRows([]); setSearch(""); setSource(value); }} options={[
      { value: "organization", label: "本组织发布引入" }, { value: "all", label: "全部 Catalog 主体" }]} /></label>
    {rows.length ? <label className="batch-registration__search">搜索主体<SearchField ariaLabel="搜索待登记主体" placeholder="主体名称、类型或展示别名" value={search} onValueChange={setSearch} /></label> : null}
    <button type="button" className="button subtle" onClick={() => void refresh()} disabled={loading || pending}>重新读取</button></div>
    {loading ? <p>正在读取待登记主体…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {successCount !== null ? <p role="status">已登记 {successCount} 个主体。</p> : null}
    {rows.length ? <><div className="batch-registration__bulk"><p>勾选用于批量设置业务分类。实际登记范围由每行“加入本批 / 移出本批”决定。批量操作包含搜索隐藏的已勾选主体。</p>
    <div className="batch-registration__toolbar"><label>批量业务分类<SelectControl ariaLabel="批量业务分类" value={bulkCategory} disabled={loading || pending} onValueChange={setBulkCategory} options={options} /></label>
      <button type="button" className="button subtle" disabled={!bulkCategory || !selected.length || loading || pending} onClick={() => {
        setEditedSubjects((current) => new Set([...current, ...selected.map((row) => row.subject.id)]));
        const moduleId = bulkCategory === "unclassified" ? modules.find((module) => module.kind === "unclassified" && module.parentId === null)?.id ?? "" : bulkCategory.slice("category:".length);
        setRows((current) => current.map((row) => row.selected ? { ...row,
          moduleId: moduleId && row.subject.availableModuleIds.includes(moduleId) ? moduleId : "", error: null } : row));
      }}>设置业务分类</button><span className="muted">已勾选 {selected.length} 个用于批量编辑，本批登记 {batch.length} 个。</span></div></div>
      <p className="muted">当前显示 {visibleRows.length} / {rows.length} 个主体，筛选不会移出本批。</p></> : null}
    <div className="definition-editor__table-wrap"><table className="definition-editor__table"><thead><tr><th><input type="checkbox" aria-label="全选" disabled={!rows.length || loading || pending} checked={rows.length > 0 && selected.length === rows.length} onChange={(event) => {
      setEditedSubjects(current => new Set([...current, ...rows.map(row => row.subject.id)]));
      setRows((current) => current.map((row) => ({ ...row, selected: event.target.checked })));
    }} />批量编辑</th><th>主体</th><th>业务分类</th><th>展示别名（可选）</th><th>本批登记</th></tr></thead><tbody>
      {visibleRows.map((row) => {
        const errorId = `${rowPrefix}-${row.subject.id}-error`;
        return <tr key={row.subject.id} data-in-batch={row.inBatch}><td><input type="checkbox" aria-label={`选择 ${row.subject.canonicalName}`} checked={row.selected} disabled={loading || pending} onChange={(event) => update(row.subject.id, { selected: event.target.checked })} /></td>
          <td>{row.subject.canonicalName} · {catalogSubjectTypeLabel(row.subject.kind)}{row.subject.childCount ? <p>含 {row.subject.childCount} 个子节点，将随驱动一同登记。</p> : null}{row.error?.field === "subject" ? <p className="field-error" role="alert">{row.error.message}</p> : null}</td>
          <td><SelectControl ariaLabel={`${row.subject.canonicalName} 的业务分类`} value={row.moduleId} disabled={loading || pending} onValueChange={(moduleId) => update(row.subject.id, { moduleId })}
            ariaInvalid={row.error?.field === "category"} ariaDescribedBy={row.error?.field === "category" ? errorId : undefined} options={[
            { value: "", label: "请选择业务分类" },
            ...modules.filter((module) => (module.kind === "business" || (module.kind === "unclassified" && module.parentId === null)) && row.subject.availableModuleIds.includes(module.id)).map((module) => ({ value: module.id, label: modulePathSegments(module, modules).join(" / ") })),
            ...(row.moduleId && (!row.subject.availableModuleIds.includes(row.moduleId) || !modules.some((module) => module.id === row.moduleId)) ? [{ value: row.moduleId, label: "目标模块已不可用", hidden: true }] : []),
          ]} />{row.error?.field === "category" ? <p id={errorId} className="field-error" role="alert">{row.error.message}</p> : null}</td>
          <td><Input aria-label={`${row.subject.canonicalName} 的展示别名`} value={row.displayAlias} disabled={loading || pending} onChange={(event) => update(row.subject.id, { displayAlias: event.target.value })} maxLength={128}
            aria-invalid={row.error?.field === "name"} aria-describedby={row.error?.field === "name" ? errorId : undefined} />
            {row.error?.field === "name" ? <p id={errorId} className="field-error" role="alert">{row.error.message}</p> : null}</td><td><span className="batch-registration__membership">{row.inBatch ? "已加入" : "未加入"}</span><button type="button" className="button subtle" disabled={loading || pending} onClick={() => update(row.subject.id, { inBatch: !row.inBatch })}>{row.inBatch ? "移出本批" : "加入本批"}</button></td></tr>;
      })}
      {!loading && rows.length > 0 && !visibleRows.length ? <tr><td colSpan={5}>没有匹配的主体，请调整搜索内容。</td></tr> : null}
      {!loading && !rows.length && !error ? <tr><td colSpan={5}>{source === "organization" ? "本组织发布引入的主体都已登记。可切换来源查看全部 Catalog 主体。" : "当前目录中没有待登记主体。"}</td></tr> : null}
    </tbody></table></div>
    </section></div>
    <div className="dialog-actions">{onClose ? <button type="button" className="button subtle" onClick={requestClose} disabled={pending}>关闭</button> : null}
      {rows.length ? <button type="button" className="button primary" onClick={prepare} disabled={loading || pending || !evidenceFresh || !batch.length}>继续确认（{batch.length}）</button> : null}</div>
    <ConfirmDialog open={confirm} title="确认批量登记" confirmLabel="确认登记" pending={pending} onCancel={() => setConfirm(false)} onConfirm={() => void submit()}
      description={<><p>登记 {batch.length} 个主体。</p>{[...groups].map(([name, count]) => <p key={name}>{name}：{count} 个</p>)}</>} />
    <ConfirmDialog open={leaveOpen} title="放弃未保存的登记修改？" description="关闭将丢失当前选择、业务分类和展示别名。"
      confirmLabel="放弃修改" cancelLabel="继续编辑" onConfirm={() => { setLeaveOpen(false); onClose?.(); }} onCancel={() => setLeaveOpen(false)} />
  </>;
  return onClose ? <ModalDialog open onDismiss={pending ? undefined : requestClose}
    className="confirm-dialog governance-confirm-dialog parameter-catalog__pending-dialog review-workbench-dialog" describedBy>
    {({ titleId, descriptionId }) => <><h2 id={titleId}>待登记主体</h2>{content(descriptionId)}</>}
  </ModalDialog> : content();
}
