import { useCallback, useEffect, useRef, useState } from "react";
import { isCatalogActionEnabled, type CatalogActorKind } from "@/application/parameter-catalog/authority";
import { catalogStateFromFailure, deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import type { CatalogResponseWithEtag } from "@/infrastructure/http/parameterCatalogClient";
import type { CatalogRegistrationResponse, CatalogSubjectResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { presentError } from "@/infrastructure/http/presentError";
import { createGovernanceSubmitGate, fingerprintGovernanceDraft } from "./governanceState";

type Props = {
  intent: "retire-registration" | "restore-registration";
  subject: CatalogSubjectResponse["item"];
  registrationId: string;
  actor: CatalogActorKind;
  catalog: ParameterCatalogRepository;
  governance: ParameterCatalogGovernanceRepository;
  organizationId: string;
  modules: readonly ParameterModule[];
  onClose: () => void;
  onCompleted: () => void;
};

export function RegistrationLifecycleDialog({ intent, subject, registrationId, actor, catalog, governance,
  organizationId, modules, onClose, onCompleted }: Props) {
  const removing = intent === "retire-registration";
  const action = removing ? "移除" : "恢复";
  const target = subject.type === "driver" ? "驱动" : subject.type === "node-type" ? "节点类型" : "配置规范";
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [evidence, setEvidence] = useState<{
    registration: CatalogRegistrationResponse["item"];
    subject: CatalogSubjectResponse["item"];
    ifMatch: string;
    catalogReleaseId: string;
  } | null>(null);
  const generation = useRef(0);
  const gate = useRef(createGovernanceSubmitGate());

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setEvidence(null);
    setError("");
    gate.current.reset();
    try {
      const document = await catalog.getCatalog();
      if (!document.item || !isCatalogActionEnabled(actor, intent, deriveCatalogDomainState({ document }))) {
        throw new Error("当前目录状态不允许操作，请稍后刷新。");
      }
      const catalogReleaseId = document.item.catalogReleaseId;
      const [registration, owner] = await Promise.all([
        governance.getRegistration(organizationId, registrationId) as Promise<CatalogResponseWithEtag<CatalogRegistrationResponse>>,
        catalog.getSubject(subject.id, { catalogReleaseId })
      ]);
      if (current !== generation.current) return;
      const ifMatch = registration.etag?.trim();
      if (!ifMatch || !registration.item.impact) throw new Error("缺少登记版本或引用影响数据，请刷新后重试。");
      if (registration.item.subjectId !== subject.id || registration.item.organizationId !== organizationId) throw new Error("登记与当前主体不匹配，请关闭后重新选择。");
      if (registration.item.status !== (removing ? "active" : "retired")) throw new Error("登记状态已变化，请关闭弹窗并刷新列表。");
      if (!removing && owner.item.membership.status !== "active") throw new Error("平台主体已退役，当前无法恢复登记。");
      setEvidence({ registration: registration.item, subject: owner.item, ifMatch, catalogReleaseId });
    } catch (failure) {
      if (current === generation.current) setError(presentError(failure, "无法读取登记与引用影响，请刷新后重试。"));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [actor, catalog, governance, intent, organizationId, registrationId, removing, subject.id]);

  useEffect(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]);

  const submit = async () => {
    if (!evidence || loading || pending || !reason.trim()) return;
    const prepared = gate.current.begin({ actor, action: intent,
      state: { kind: "ready", catalogReleaseId: evidence.catalogReleaseId, writesEnabled: true },
      catalogReleaseId: evidence.catalogReleaseId, ifMatch: evidence.ifMatch,
      draftFingerprint: fingerprintGovernanceDraft({ intent, registrationId, reason: reason.trim() }) });
    if (prepared.status !== "ready" || !("ifMatch" in prepared.context)) return;
    setPending(true);
    setError("");
    try {
      const write = removing ? governance.retireRegistration : governance.restoreRegistration;
      await write(organizationId, registrationId, { reason: reason.trim() }, prepared.context);
      gate.current.succeed();
      onCompleted();
    } catch (failure) {
      gate.current.fail();
      const state = catalogStateFromFailure(failure);
      setError(state.kind === "conflict" ? "登记或目录版本已变化，输入已保留。请刷新影响数据并重新确认。" : presentError(failure, `${action}失败，请刷新影响数据后重试。`));
      // The result may have committed despite a lost response. Re-read before another decision.
      setEvidence(null);
    } finally {
      setPending(false);
    }
  };

  const placement = evidence?.registration.placement;
  const currentModule = placement?.moduleId ? modules.find(module => module.id === placement.moduleId) : undefined;
  const impact = evidence?.registration.impact;
  return <ConfirmDialog key={`${evidence?.catalogReleaseId}:${evidence?.ifMatch}`} open title={`${action}${target}`} confirmLabel={`确认${action}`} tone={removing ? "danger" : "primary"}
    pending={pending} confirmDisabled={loading || !evidence || !reason.trim()} onConfirm={() => void submit()} onCancel={onClose}
    acknowledgement={removing ? "我已了解对项目使用和编辑提交的影响，确认停用本组织登记" : "我已核对恢复后的模块归属，确认恢复本组织登记"}
    error={error}
    description={<>
      <p><strong>{subject.canonicalName}</strong></p>
      {loading ? <p role="status">正在读取登记与引用影响…</p> : null}
      {evidence && impact ? <>
        <p>当前归属：{currentModule?.name ?? "unset（未分配模块）"}。{evidence.subject.definitionCounts.active} 个有效定义，{impact.bindingCount} 个参数绑定，涉及 {impact.projectCount} 个项目。</p>
        {removing ? <p>移除后，本组织登记将停用并从默认有效列表隐藏。新绑定及相关项目参数的部分编辑、提交将被阻止。定义、项目参数值和历史记录保留，可在“已停用”中恢复。</p>
          : <p>恢复后沿用原登记和归属。{currentModule ? "相关参数可继续使用。" : "原模块已删除或归属未设置，恢复后请调整归属。"}</p>}
        {impact.projects?.length ? <details><summary>查看受影响项目</summary><ul>{impact.projects.map(project => <li key={project.id}>
          <a href={`/parameters?project=${encodeURIComponent(project.id)}`} target="_blank" rel="noreferrer">{project.name}</a> · {project.bindingCount} 个参数绑定
        </li>)}</ul></details> : null}
        {impact.projects && impact.projectCount > impact.projects.length ? <p>仅列出前 {impact.projects.length} 个项目，共 {impact.projectCount} 个项目。</p> : null}
      </> : null}
    </>}
    extra={<>
      <label className="registration-dialog-fields">操作原因<textarea aria-label="操作原因" value={reason} disabled={pending} onChange={event => setReason(event.target.value)} /></label>
      {!loading && !evidence ? <button type="button" className="button subtle" disabled={pending} onClick={() => void refresh()}>刷新影响数据</button> : null}
    </>} />;
}
