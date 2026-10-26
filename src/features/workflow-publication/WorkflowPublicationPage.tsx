import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { SettingsFormPage, SettingsFormSection, useDirtyState } from "@/components/layout/SettingsFormPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ViewSwitch } from "@/components/ui/view-switch";
import { formatAuditAbsoluteTime } from "@/domain/audit/formatAuditTime";
import { WORKFLOW_IDS, WORKFLOW_OFFER_LABELS, type WorkflowId } from "@/domain/workflowDiscovery";
import type { WorkflowPublicationAdminState } from "@/domain/workflowPublication";
import { presentError } from "@/infrastructure/http/presentError";
import type { WorkflowPublicationClient } from "@/infrastructure/http/workflowPublicationClient";
import "./workflow-publication.css";

const WORKFLOW_DESCRIPTIONS: Record<WorkflowId, string> = {
  "parameter-management": "参数配置、项目工作台与变更审核。",
  debugging: "参数调试、节点调试及调试管理。",
  "log-analysis": "日志上传、智能分析与日志管理。",
  knowledge: "知识条目的检索、创建与管理。"
};

type WorkflowPublicationPageProps = {
  client: WorkflowPublicationClient;
  onSaved?: (state: WorkflowPublicationAdminState) => void;
};

export function WorkflowPublicationPage({ client, onSaved }: WorkflowPublicationPageProps) {
  const [saved, setSaved] = useState<WorkflowPublicationAdminState | null>(null);
  const [draft, setDraft] = useState<WorkflowPublicationAdminState["workflows"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false);
  const dirty = useDirtyState(draft, saved?.workflows ?? null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    void client.getAdministration().then((next) => {
      if (cancelled) return;
      setSaved(next);
      setDraft(next.workflows);
      setSaveError("");
      setStatus("");
      setConflict(false);
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(presentError(error, "无法加载工作流发布配置，请重试。"));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [client, loadAttempt]);

  const reload = () => {
    if (loading || saving) return;
    if (dirty) setReloadConfirmOpen(true);
    else setLoadAttempt((attempt) => attempt + 1);
  };

  const save = async () => {
    if (!saved || !draft || !dirty || loading || saving || conflict || loadError) return;
    setSaving(true);
    setSaveError("");
    setStatus("");
    let next: WorkflowPublicationAdminState;
    try {
      next = await client.updatePublication({ workflows: draft, expectedVersion: saved.version });
      setSaved(next);
      setDraft(next.workflows);
      setStatus("工作流发布配置已保存，将在用户下次刷新或页面跳转时生效。");
    } catch (error: unknown) {
      const stale = Boolean(error && typeof error === "object" && "code" in error && error.code === "CONFLICT");
      setConflict(stale);
      setSaveError(stale
        ? "发布配置已被其他管理员修改。你的修改已保留，请重新加载最新配置后再编辑。"
        : presentError(error, "保存发布配置失败，你的修改已保留。"));
      return;
    } finally {
      setSaving(false);
    }
    onSaved?.(next);
  };

  return <div className="workflow-publication-page">
    <SettingsFormPage label="工作流发布设置" dirty={dirty} saving={saving}
      saveDisabled={loading || conflict || Boolean(loadError)} error={saveError}
      onSave={() => void save()} onDiscard={() => {
        setDraft(saved?.workflows ?? null);
        if (!conflict) setSaveError("");
        setStatus("");
      }}>
      <SettingsFormSection title="面向用户开放的工作流" help="统一设置所有组织的界面开放范围。调整开关后，保存才会生效。">
        {loading ? <SectionSkeleton label="正在加载发布配置" /> : null}
        {loadError ? <SectionError message={loadError} onRetry={reload} /> : null}
        {saved && draft ? <>
          <div className="workflow-publication-page__summary">
            <span>已开放 {WORKFLOW_IDS.filter((id) => saved.workflows[id]).length} / {WORKFLOW_IDS.length} 项</span>
            <Button type="button" variant="outline" size="sm" disabled={loading || saving} onClick={reload}>重新加载配置</Button>
          </div>
          <div className="workflow-publication-page__workflows">
            {WORKFLOW_IDS.map((id) => <section className="workflow-publication-page__workflow" aria-label={WORKFLOW_OFFER_LABELS[id]} key={id}>
              <div className="workflow-publication-page__description">
                <h3>{WORKFLOW_OFFER_LABELS[id]}{draft[id] !== saved.workflows[id] ? <Badge variant="secondary">未保存</Badge> : null}</h3>
                <p>{WORKFLOW_DESCRIPTIONS[id]}</p>
                <span>已保存：{saved.workflows[id] ? "开放" : "不开放"}</span>
              </div>
              <ViewSwitch variant="toggle" ariaLabel={`${WORKFLOW_OFFER_LABELS[id]}开放状态`}
                value={draft[id] ? "published" : "unpublished"}
                items={[
                  { value: "published", label: "开放", disabled: loading || saving || Boolean(loadError) },
                  { value: "unpublished", label: "不开放", disabled: loading || saving || Boolean(loadError) }
                ]}
                onValueChange={(value) => {
                  setDraft((current) => current ? { ...current, [id]: value === "published" } : current);
                  if (!conflict) setSaveError("");
                  setStatus("");
                }} />
            </section>)}
          </div>
        </> : null}
        {status ? <p className="workflow-publication-page__status" role="status">{status}</p> : null}
      </SettingsFormSection>
    </SettingsFormPage>
    <aside className="workflow-publication-page__aside" aria-label="发布说明与记录">
      <section className="workflow-publication-page__card" aria-label="生效范围">
        <h2>生效范围</h2>
        <p>普通用户只能进入已开放的工作流。组织管理员和平台超级管理员始终可见，仍遵守原有数据和操作权限。</p>
        <p>关闭后，用户下次刷新或页面跳转时生效；正在使用的页面不会强制退出。</p>
        <p>关闭知识库后，其他页面保留只读知识参考。API 和小泽仍按原有权限使用相关能力。</p>
      </section>
      {saved ? <section className="workflow-publication-page__card" aria-label="发布记录">
        <h2>最近保存</h2>
        {saved.updatedAt ? <dl>
          <div><dt>修改人</dt><dd title={saved.updatedBy ? `账户 ${saved.updatedBy.id}` : undefined}>{saved.updatedBy?.name ?? "已删除账户"}</dd></div>
          <div><dt>保存时间</dt><dd><time dateTime={saved.updatedAt}>{formatAuditAbsoluteTime(saved.updatedAt)}</time></dd></div>
        </dl> : <p>尚未修改发布配置，当前使用初始开放设置。</p>}
        <p>保存后的变更可在审计中心查看。</p>
      </section> : null}
    </aside>
    <ConfirmDialog open={reloadConfirmOpen} title="重新加载并放弃当前修改？"
      description="读取最新发布配置后，将替换本页尚未保存的修改。" confirmLabel="放弃并重新加载" cancelLabel="保留当前修改" tone="danger"
      onCancel={() => setReloadConfirmOpen(false)} onConfirm={() => {
        setReloadConfirmOpen(false);
        setLoadAttempt((attempt) => attempt + 1);
      }} />
  </div>;
}
