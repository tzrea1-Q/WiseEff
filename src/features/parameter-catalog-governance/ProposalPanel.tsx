import { SelectControl } from "@/components/common/SelectControl";
import type { SharedDtsiRecognitionReference } from "@wiseeff/dto-schemas";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import { catalogStateFromFailure, type CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { CatalogProposalResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { DataTable, type Column } from "@/components/admin";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";

import {
  canExecuteGovernanceAction,
  createGovernanceSubmitGate,
  fingerprintGovernanceDraft,
  governanceCopy,
  governanceFailureMessage,
  proposalChangeKindLabels,
  proposalStatusLabels,
  type GovernanceSubmitGate
} from "./governanceState";

type ProposalItem = CatalogProposalResponse["item"];
type ProposalAction = "create" | "submit" | "withdraw" | "accept" | "reject";

export type ProposalPanelProps = {
  source?:{reference:SharedDtsiRecognitionReference;label:string;href:string};
  onDirtyChange?:(dirty:boolean)=>void;
  onPendingChange?:(pending:boolean)=>void;
  actor: CatalogActorKind;
  domainState: CatalogDomainState;
  repository: ParameterCatalogGovernanceRepository;
  catalogReleaseId: string;
  currentPersonId: string;
  definitionId?: string;
  definitionRevisionId?: string;
  createIdempotencyKey?: () => string;
  onRefreshEvidence?: () => void | Promise<void>;
};

const CHANGE_KINDS = ["documentation", "content", "lifecycle"] as const;

export function ProposalPanel({
  source,
  onDirtyChange,
  onPendingChange,
  actor,
  domainState,
  repository,
  catalogReleaseId,
  currentPersonId,
  definitionId,
  definitionRevisionId,
  createIdempotencyKey,
  onRefreshEvidence
}: ProposalPanelProps) {
  const canCreate = canExecuteGovernanceAction(actor, "create-proposal", domainState);
  const canSubmit = canExecuteGovernanceAction(actor, "submit-proposal", domainState);
  const canWithdraw = canExecuteGovernanceAction(actor, "withdraw-proposal", domainState);
  const canAccept = canExecuteGovernanceAction(actor, "accept-proposal", domainState);
  const canReject = canExecuteGovernanceAction(actor, "reject-proposal", domainState);
  const readOnly = actor === "agent" || (!canCreate && !canSubmit && !canWithdraw && !canAccept && !canReject);

  const gateRef = useRef<GovernanceSubmitGate>(createGovernanceSubmitGate());
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changeKind, setChangeKind] = useState<(typeof CHANGE_KINDS)[number]>("documentation");
  const [reason, setReason] = useState("");
  const [repositoryReference, setRepositoryReference] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(()=>{onPendingChange?.(pending);},[pending,onPendingChange]);
  const [writeFailure, setWriteFailure] = useState<CatalogDomainState | undefined>();
  const [confirmAction, setConfirmAction] = useState<ProposalAction | null>(null);
  const [target, setTarget] = useState<ProposalItem | null>(null);
  const [intentRecorded, setIntentRecorded] = useState(false);
  const activeSourceProposal=Boolean(source && items.some(item=>item.status==="draft"||item.status==="submitted"));
  useEffect(()=>{onDirtyChange?.(Boolean(source && reason.trim() && !activeSourceProposal));},[source,reason,activeSourceProposal,onDirtyChange]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Bounded, organization-wide: a proposal raised against an earlier
      // release must stay reachable so its author can still withdraw it after
      // the catalog advances. The bound is what keeps the list from growing
      // past the panel's own pagination.
      const response = await repository.listProposals({ limit: 50 });
      // Order by the authoritative creation time so the newest draft is the
      // first actionable row, matching the persisted projection order.
      setItems(
        [...response.items].filter(item=>{
          if(!source)return true;
          const reference=item.requestedChange.sourceReference;
          return reference && typeof reference==="object" && !Array.isArray(reference)
            && Object.entries(source.reference).every(([key,value])=>(reference as Record<string,unknown>)[key]===value);
        }).sort((left, right) =>
          (right.createdAt ?? "").localeCompare(left.createdAt ?? "")
        )
      );
    } catch {
      setError("定义修订加载失败，请稍后重试。");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [catalogReleaseId, repository,source]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!confirmAction || pending) {
      return;
    }
    const action =
      confirmAction === "create"
        ? "create-proposal"
        : confirmAction === "submit"
          ? "submit-proposal"
          : confirmAction === "withdraw"
            ? "withdraw-proposal"
            : confirmAction === "accept"
              ? "accept-proposal"
              : "reject-proposal";
    const prepared = gateRef.current.begin({
      actor,
      action,
      state: domainState,
      catalogReleaseId,
      ifMatch: confirmAction === "create" ? undefined : target?.etag,
      draftFingerprint: fingerprintGovernanceDraft({
        confirmAction,
        reason,
        changeKind,
        repositoryReference,
        proposalId: target?.id
      }),
      createIdempotencyKey
    });
    if (prepared.status !== "ready") {
      return;
    }
    setPending(true);
    try {
      if (confirmAction === "create") {
        await repository.createProposal(
          {
            base: {
              catalogReleaseId,
              ...(definitionId ? { definitionId } : {}),
              ...(definitionRevisionId ? { definitionRevisionId } : {})
            },
            requestedChange: source ? {kind:"source-recognition",sourceReference:source.reference,description:reason.trim()} : { kind: changeKind },
            reason: reason.trim()
          },
          prepared.context
        );
      } else if (target && confirmAction === "submit") {
        await repository.submitProposal(target.id, {}, {
          catalogReleaseId: prepared.context.catalogReleaseId,
          idempotencyKey: prepared.context.idempotencyKey,
          ifMatch: "ifMatch" in prepared.context ? prepared.context.ifMatch : ""
        });
      } else if (target && confirmAction === "withdraw") {
        await repository.withdrawProposal(target.id, {}, {
          catalogReleaseId: prepared.context.catalogReleaseId,
          idempotencyKey: prepared.context.idempotencyKey,
          ifMatch: "ifMatch" in prepared.context ? prepared.context.ifMatch : ""
        });
      } else if (target && confirmAction === "accept") {
        const response = await repository.acceptProposal(
          target.id,
          { repositoryReference: repositoryReference.trim() },
          {
            catalogReleaseId: prepared.context.catalogReleaseId,
            idempotencyKey: prepared.context.idempotencyKey,
            ifMatch: "ifMatch" in prepared.context ? prepared.context.ifMatch : ""
          }
        );
        if (response.item.publicationIntentRef) {
          setIntentRecorded(true);
        }
      } else if (target && confirmAction === "reject") {
        await repository.rejectProposal(
          target.id,
          { reason: reason.trim() },
          {
            catalogReleaseId: prepared.context.catalogReleaseId,
            idempotencyKey: prepared.context.idempotencyKey,
            ifMatch: "ifMatch" in prepared.context ? prepared.context.ifMatch : ""
          }
        );
      }
      gateRef.current.succeed();
      setWriteFailure(undefined);
      setConfirmAction(null);
      setTarget(null);
      await load();
    } catch (error) {
      gateRef.current.fail();
      setWriteFailure(catalogStateFromFailure(error));
      setConfirmAction(null);
    } finally {
      setPending(false);
    }
  };

  const columns: Column<ProposalItem>[] = [
    ...(source?[{key:"description",header:"变更说明",render:(row:ProposalItem)=><span className="parameter-text-content">{typeof row.requestedChange.description==="string"?row.requestedChange.description:"说明见原修订记录"}</span>}]:[]),
    {
      key: "status",
      header: "状态",
      className:source?"whitespace-nowrap":undefined,
      render: (row) => proposalStatusLabels[row.status]
    },
    ...(!source?[{
      key: "change",
      header: "变更",
      render: (row:ProposalItem) =>
        proposalChangeKindLabels[row.requestedChange.kind as keyof typeof proposalChangeKindLabels] ??
        "修订"
    },
    {
      key: "version",
      header: "版本",
      render: (row:ProposalItem) => String(row.version)
    }]:[])
  ];

  const confirmMeta: Record<ProposalAction, { title: string; label: string }> = {
    create: { title: governanceCopy.confirmCreateProposalTitle, label: governanceCopy.confirmCreateProposal },
    submit: { title: governanceCopy.confirmSubmitTitle, label: governanceCopy.confirmSubmit },
    withdraw: { title: governanceCopy.confirmWithdrawTitle, label: governanceCopy.confirmWithdraw },
    accept: { title: governanceCopy.confirmAcceptTitle, label: governanceCopy.confirmAccept },
    reject: { title: governanceCopy.confirmRejectTitle, label: governanceCopy.confirmReject }
  };

  return (
    <section
      className="parameter-catalog__proposal"
      aria-label={source?"来源识别修订":governanceCopy.proposalPanel}
      data-proposal-materialize="false"
    >
      <p>{source?"提交识别修订供审核；不会创建参数定义或绑定项目实例。":governanceCopy.proposalNoMaterialize}</p>
      {source?<p className="shared-dtsi-source-context">来源：<a href={source.href} target="_blank" rel="noreferrer">{source.label}</a></p>:null}
      {readOnly ? <p>{governanceCopy.agentReadOnly}</p> : null}
      {canCreate && (!source || !loading && !error && !activeSourceProposal) ? (
        <div className="governance-confirm-dialog__body">
          {!source?<label>
            {governanceCopy.changeKind}
            <SelectControl
              ariaLabel={governanceCopy.changeKind}
              value={changeKind}
              onValueChange={(value) => setChangeKind(value as (typeof CHANGE_KINDS)[number])}
              options={CHANGE_KINDS.map((kind) => ({ value: kind, label: proposalChangeKindLabels[kind] }))}
            />
          </label>:null}
          <label>
            {source?"变更说明":governanceCopy.reason}
            <textarea
              aria-label={source?"变更说明":governanceCopy.reason}
              rows={3} value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="button primary sm"
            disabled={pending || reason.trim().length === 0}
            onClick={() => {
              gateRef.current.reset();
              setConfirmAction("create");
            }}
          >
            {governanceCopy.continueConfirm}
          </button>
        </div>
      ) : null}
      {canAccept || canReject ? (
        <div className="governance-confirm-dialog__body">
          <label>
            {governanceCopy.repositoryReference}
            <input
              aria-label={governanceCopy.repositoryReference}
              value={repositoryReference}
              onChange={(event) => setRepositoryReference(event.target.value)}
            />
          </label>
          {canReject ? (
            <label>
              {governanceCopy.reason}
              <textarea
                aria-label={governanceCopy.reason}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          ) : null}
        </div>
      ) : null}
      {writeFailure ? (
        <p
          className="governance-confirm-dialog__error"
          role="alert"
          data-preserve-input={writeFailure.kind === "conflict" ? "true" : undefined}
          data-silent-retry="false"
        >
          {governanceFailureMessage(writeFailure)}
        </p>
      ) : null}
      {intentRecorded ? <p>{governanceCopy.proposalIntentRecorded}</p> : null}
      {loading ? <SectionSkeleton label="正在加载定义修订" /> : null}
      {error ? <SectionError message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && items.length === 0 ? <SectionEmpty message={source?"已加载的最近 50 条组织修订中没有此来源的记录。":"当前没有定义修订。"} /> : null}
      {!loading && !error && items.length > 0 ? (
        <DataTable
          fluid={Boolean(source)}
          rows={items}
          rowKey={(row) => row.id}
          columns={columns}
          ariaLabel={governanceCopy.proposalPanel}
          renderRowActions={(row) => (
            <>
              {canSubmit && row.status === "draft" ? (
                <button
                  type="button"
                  className="button sm"
                  onClick={() => {
                    setTarget(row);
                    setConfirmAction("submit");
                  }}
                >
                  {governanceCopy.submitProposal}
                </button>
              ) : null}
              {canWithdraw && (row.status === "submitted" || row.status === "draft") ? (
                <button
                  type="button"
                  className="button sm"
                  onClick={() => {
                    setTarget(row);
                    setConfirmAction("withdraw");
                  }}
                >
                  {governanceCopy.withdrawProposal}
                </button>
              ) : null}
              {canAccept && row.status === "submitted" ? (
                <button
                  type="button"
                  className="button sm"
                  disabled={row.submittedByPersonId === currentPersonId || repositoryReference.trim().length === 0}
                  title={
                    row.submittedByPersonId === currentPersonId ? governanceCopy.selfApproval : undefined
                  }
                  onClick={() => {
                    setTarget(row);
                    setConfirmAction("accept");
                  }}
                >
                  {governanceCopy.acceptProposal}
                </button>
              ) : null}
              {canReject && row.status === "submitted" ? (
                <button
                  type="button"
                  className="button sm"
                  disabled={reason.trim().length === 0}
                  onClick={() => {
                    setTarget(row);
                    setConfirmAction("reject");
                  }}
                >
                  {governanceCopy.rejectProposal}
                </button>
              ) : null}
            </>
          )}
        />
      ) : null}
      {onRefreshEvidence && writeFailure ? (
        <button
          type="button"
          className="button ghost sm"
          disabled={loading || pending}
          onClick={async () => {
            setConfirmAction(null);
            setTarget(null);
            gateRef.current.reset();
            setLoading(true);
            setError(null);
            try {
              await onRefreshEvidence();
              await load();
            } catch {
              setError("定义修订证据刷新失败，请稍后重试。");
              setLoading(false);
            }
          }}
        >
          {governanceCopy.refreshEvidence}
        </button>
      ) : null}
      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction ? confirmMeta[confirmAction].title : governanceCopy.proposalPanel}
        description={<p>{governanceCopy.proposalNoMaterialize}</p>}
        confirmLabel={confirmAction ? confirmMeta[confirmAction].label : governanceCopy.continueConfirm}
        pending={pending}
        pendingLabel={governanceCopy.pending}
        acknowledgement={governanceCopy.proposalAck}
        onConfirm={() => void submit()}
        onCancel={() => {
          setConfirmAction(null);
          setTarget(null);
        }}
      />
    </section>
  );
}
