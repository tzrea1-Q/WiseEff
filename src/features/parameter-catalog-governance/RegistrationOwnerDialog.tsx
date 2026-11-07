import { useCallback, useEffect, useRef, useState } from "react";
import { isCatalogActionEnabled, type CatalogActorKind } from "@/application/parameter-catalog/authority";
import { listAllCanonicalPages } from "@/application/parameter-catalog/listAllCanonicalPages";
import { catalogStateFromFailure, deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { Textarea } from "@/components/ui/textarea";
import type { CatalogResponseWithEtag } from "@/infrastructure/http/parameterCatalogClient";
import type { CatalogRegistrationResponse, CatalogSubjectResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { presentError } from "@/infrastructure/http/presentError";
import { createGovernanceSubmitGate, fingerprintGovernanceDraft } from "./governanceState";
import type { SubjectEditorOptions } from "./RegistrationDialog";

type Props = {
  editor?: SubjectEditorOptions;
  subject: CatalogSubjectResponse["item"];
  registrationId: string;
  actor: CatalogActorKind;
  sessionPermissions?: readonly string[] | null;
  catalog: ParameterCatalogRepository;
  governance: ParameterCatalogGovernanceRepository;
  organizationId: string;
  onClose: () => void;
  onCompleted: () => void;
};

export function RegistrationOwnerDialog({ editor, subject, registrationId, actor, sessionPermissions, catalog, governance,
  organizationId, onClose, onCompleted }: Props) {
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [evidence, setEvidence] = useState<{
    registration: CatalogRegistrationResponse["item"];
    subject: CatalogSubjectResponse["item"];
    ownerName: string;
    targets: { id: string; name: string; registrationId: string }[];
    ifMatch: string;
    catalogReleaseId: string;
  } | null>(null);
  const generation = useRef(0);
  const gate = useRef(createGovernanceSubmitGate());
  const leaveAction = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setEvidence(null);
    setError("");
    gate.current.reset();
    try {
      const document = await catalog.getCatalog();
      if (!document.item || !isCatalogActionEnabled(actor, "update-placement", deriveCatalogDomainState({ document }), sessionPermissions)) {
        throw new Error("当前身份或目录状态不允许调整归属。");
      }
      const catalogReleaseId = document.item.catalogReleaseId;
      const [registration, currentSubject, drivers, registrations] = await Promise.all([
        governance.getRegistration(organizationId, registrationId) as Promise<CatalogResponseWithEtag<CatalogRegistrationResponse>>,
        catalog.getSubject(subject.id, { catalogReleaseId }),
        listAllCanonicalPages(query => catalog.listSubjects(query), { type: "driver", lifecycle: "active", catalogReleaseId }),
        listAllCanonicalPages(query => governance.listRegistrations(organizationId, query), { catalogReleaseId })
      ]);
      if (current !== generation.current) return;
      const ifMatch = registration.etag?.trim();
      // Pinned Catalog ownership may be shared; this registration carries the organization's current owner.
      const ownerId = registration.item.ownerSubjectId;
      const projectedOwnerId = currentSubject.item.registration.status === "unregistered"
        ? undefined : currentSubject.item.registration.placement?.ownerSubjectId;
      if (!ifMatch || !registration.item.impact) throw new Error("缺少登记版本或引用影响数据，请刷新后重试。");
      if (registration.item.id !== registrationId || registration.item.organizationId !== organizationId || registration.item.subjectId !== subject.id ||
        registration.item.status !== "active" || !ownerId || currentSubject.item.id !== subject.id || currentSubject.item.type !== "node-type" ||
        currentSubject.item.membership.status !== "active" || (projectedOwnerId && projectedOwnerId !== ownerId)) {
        throw new Error("节点登记或归属已变化，请关闭弹窗并刷新列表。");
      }
      const owner = drivers.find(driver => driver.id === ownerId) ?? (await catalog.getSubject(ownerId, { catalogReleaseId })).item;
      if (current !== generation.current) return;
      const activeRegistrations = new Map(registrations.filter(item => item.organizationId === organizationId && item.status === "active")
        .map(item => [item.subjectId, item]));
      const targets = drivers.flatMap(driver => {
        const targetRegistration = activeRegistrations.get(driver.id);
        return driver.type === "driver" && (driver.canonicalType ?? driver.type) === "driver" && driver.membership.status === "active" && !driver.ownerSubjectId && driver.id !== ownerId && targetRegistration
          ? [{ id: driver.id, name: driver.canonicalName, registrationId: targetRegistration.id }] : [];
      });
      setEvidence({ registration: registration.item, subject: currentSubject.item, ownerName: owner.canonicalName, targets, ifMatch, catalogReleaseId });
    } catch (failure) {
      if (current === generation.current) setError(presentError(failure, "无法读取节点归属与影响，请重试。"));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [actor, catalog, governance, organizationId, registrationId, sessionPermissions, subject.id]);

  useEffect(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]);

  const target = evidence?.targets.find(item => item.id === targetId);
  const submit = async () => {
    if (!evidence || !target || loading || pending || error || !reason.trim()) return;
    const prepared = gate.current.begin({ actor, action: "update-placement",
      state: { kind: "ready", catalogReleaseId: evidence.catalogReleaseId, writesEnabled: true },
      catalogReleaseId: evidence.catalogReleaseId, ifMatch: evidence.ifMatch,
      draftFingerprint: fingerprintGovernanceDraft({ organizationId, registrationId, ownerSubjectId: target.id, reason: reason.trim() }) });
    if (prepared.status !== "ready" || !("ifMatch" in prepared.context)) return;
    setPending(true);
    setError("");
    try {
      const [driver, registration] = await Promise.all([
        catalog.getSubject(target.id, { catalogReleaseId: evidence.catalogReleaseId }),
        governance.getRegistration(organizationId, target.registrationId)
      ]);
      if (driver.item.id !== target.id || driver.item.type !== "driver" || driver.item.membership.status !== "active" || driver.item.ownerSubjectId ||
        registration.item.id !== target.registrationId || registration.item.subjectId !== target.id || registration.item.organizationId !== organizationId || registration.item.status !== "active") {
        throw new Error("目标驱动已不可用，请刷新影响数据并重新选择。");
      }
      await governance.changeRegistrationOwner(organizationId, registrationId,
        { ownerSubjectId: target.id, reason: reason.trim() }, prepared.context);
      gate.current.succeed();
      onCompleted();
    } catch (failure) {
      gate.current.fail();
      setError(catalogStateFromFailure(failure).kind === "conflict"
        ? "登记或目录版本已变化，输入已保留。请刷新影响数据并重新确认。"
        : presentError(failure, "调整归属失败，输入已保留。请刷新影响数据后重试。"));
    } finally {
      setPending(false);
    }
  };
  const requestLeave = (action: () => void) => {
    if (pending) return;
    if (targetId || reason.trim()) { leaveAction.current = action; setLeaveOpen(true); }
    else action();
  };
  const requestClose = () => requestLeave(onClose);
  const impact = evidence?.registration.impact;
  return <>
    <ConfirmDialog acknowledgementKey={`${evidence?.ifMatch}:${targetId}:${error}`} open title={editor?.title ?? "调整节点归属"} confirmLabel="确认调整归属"
      className={editor ? "registration-dialog" : undefined} headerExtra={editor?.renderNavigation(requestLeave, pending)}
      pending={pending} confirmDisabled={loading || !evidence || !target || Boolean(error) || !reason.trim()} onConfirm={() => void submit()} onCancel={requestClose}
      acknowledgement="我已核对所属驱动及影响范围，确认调整本组织的节点归属" error={error}
      description={<>
        <p><strong>{subject.canonicalName}</strong></p>
        <p>仅调整本组织的所属驱动与业务归属。定义、参数值和历史保留；不会移动 DTS 文件中的节点。</p>
        {loading ? <p role="status">正在读取所属驱动与引用影响…</p> : null}
        {evidence && impact ? <>
          <p>当前驱动：{evidence.ownerName}{target ? <> → {target.name}</> : null}</p>
          <p>{evidence.subject.definitionCounts.active} 个有效定义，{impact.bindingCount} 个参数绑定，涉及 {impact.projectCount} 个项目。</p>
          {evidence.targets.length === 0 ? <p>没有其他已启用并登记的驱动。请先在本组织登记目标驱动。</p> : null}
        </> : null}
      </>}
      extra={<section id={editor ? "subject-editor-panel" : undefined} role={editor ? "tabpanel" : undefined} aria-label={editor ? "归属" : undefined}>
        <label className="field"><span>目标驱动</span><SelectControl ariaLabel="目标驱动" value={targetId} onValueChange={setTargetId}
          options={evidence?.targets.map(item => ({ value: item.id, label: item.name })) ?? []} placeholder="请选择目标驱动"
          className="w-full" disabled={pending || loading || !evidence || Boolean(error)} /></label>
        <label className="param-admin-confirm-field">操作原因<Textarea aria-label="操作原因" rows={3} maxLength={1000} required value={reason}
          disabled={pending} onChange={event => setReason(event.target.value)} /></label>
        {!loading && (!evidence || error) ? <button type="button" className="button subtle" disabled={pending} onClick={() => void refresh()}>刷新影响数据</button> : null}
      </section>} />
    <ConfirmDialog open={leaveOpen} title="放弃未保存的归属调整？" description="目标驱动与操作原因尚未提交。" confirmLabel="放弃修改"
      cancelLabel="继续编辑" onConfirm={() => {
        const action = leaveAction.current; leaveAction.current = null; setLeaveOpen(false); (action ?? onClose)();
      }} onCancel={() => { leaveAction.current = null; setLeaveOpen(false); }} />
  </>;
}
