import { useEffect, useId, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { presentError } from "@/infrastructure/http/presentError";
import type {
  EffectiveTopologyEffect,
  IdentityMappingTask,
  ProjectParameterBinding,
  SourceTopologyNode,
  TopologyDiagnostic,
  TopologyView
} from "@/domain/parameter-topology/types";

export type BindingEditValidation = {
  valid: boolean;
  diagnostics: TopologyDiagnostic[];
};

export type BindingEditInput = {
  bindingId: string;
  rawValue: string;
  reason: string;
  action?: "set" | "delete";
};

export type BindingDetailPanelProps = {
  binding: ProjectParameterBinding;
  view: TopologyView;
  sourceNode?: SourceTopologyNode | null;
  effects?: EffectiveTopologyEffect[];
  provenanceLabels?: string[];
  mappingTasks?: IdentityMappingTask[];
  canEdit?: boolean;
  onValidateEdit?: (input: BindingEditInput) => BindingEditValidation | Promise<BindingEditValidation>;
  asDialog?: boolean;
  /** Names the hosting ModalDialog via its heading when rendered as a dialog. */
  titleId?: string;
};

export function BindingDetailPanel({
  binding,
  view,
  sourceNode,
  effects = [],
  provenanceLabels = [],
  mappingTasks = [],
  canEdit = true,
  onValidateEdit,
  asDialog = false,
  titleId
}: BindingDetailPanelProps) {
  const [draftRaw, setDraftRaw] = useState(binding.rawValue);
  const [draftReason, setDraftReason] = useState("");
  const [diagnostics, setDiagnostics] = useState<TopologyDiagnostic[]>([]);
  const [validating, setValidating] = useState(false);
  const diagnosticId = useId();

  useEffect(() => {
    setDraftRaw(binding.rawValue);
    setDraftReason("");
    setDiagnostics([]);
  }, [binding.id, binding.rawValue]);

  const openMappings = mappingTasks.filter((task) => task.status === "open");
  const submitDraft = (action: "set" | "delete") => {
    setValidating(true);
    void Promise.resolve(
      onValidateEdit?.({
        bindingId: binding.id,
        rawValue: action === "delete" ? "" : draftRaw,
        reason: draftReason.trim(),
        ...(action === "delete" ? { action } : {})
      })
    )
      .then((result) => {
        setDiagnostics(result?.diagnostics ?? []);
      })
      .finally(() => {
        setValidating(false);
      });
  };
  const Wrapper: "section" | "div" = asDialog ? "div" : "section";
  const wrapperProps = asDialog
    ? {}
    : {
        role: "region" as const,
        "aria-label": "项目参数详情",
        "data-binding-id": binding.id
      };

  return (
    <Wrapper className="binding-detail-panel" {...wrapperProps} data-binding-id={binding.id}>
      <header className="binding-detail-panel__header">
        <h3 id={titleId}>
          {binding.propertyKey}
          {binding.driverModule ? <small> · {binding.driverModule}</small> : null}
        </h3>
        <p>
          {binding.instanceName ?? "—"} · {binding.locator ?? "—"}
        </p>
      </header>

      <dl className="binding-detail-panel__meta">
        <div>
          <dt>参数记录 ID</dt>
          <dd>
            <code>{binding.id}</code>
          </dd>
        </div>
        <div>
          <dt>定义版本</dt>
          <dd>
            <code>{binding.parameterSpecVersionId}</code>
          </dd>
        </div>
        <div>
          <dt>Schema / Policy</dt>
          <dd>
            {binding.schemaState} / {binding.policyState}
          </dd>
        </div>
      </dl>

      {view === "source" ? (
        <section aria-label="源 occurrence">
          <h4>源 occurrence</h4>
          {sourceNode ? (
            <p>
              {sourceNode.fileName ? `${sourceNode.fileName} · ` : null}
              {sourceNode.fileVersionId ? `fv:${sourceNode.fileVersionId} · ` : null}
              {sourceNode.nodePath} · L{sourceNode.startLine}
              {effects[0] ? ` · ${effects[0].effectKind}` : " · set"}
            </p>
          ) : (
            <p>覆盖写入 / set</p>
          )}
        </section>
      ) : (
        <section aria-label="来源链">
          <h4>来源链 / provenance</h4>
          {provenanceLabels.length > 0 ? (
            <ol>
              {provenanceLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ol>
          ) : (
            <p>暂无来源链</p>
          )}
        </section>
      )}

      <section aria-label="类型化编辑">
        <h4>类型化编辑</h4>
        <label htmlFor={`${diagnosticId}-value`}>
          目标值
          <Textarea
            id={`${diagnosticId}-value`}
            aria-label="目标值"
            aria-invalid={diagnostics.length > 0}
            aria-describedby={diagnostics.length > 0 ? diagnosticId : undefined}
            value={draftRaw}
            disabled={!canEdit || validating}
            onChange={(event) => {
              setDraftRaw(event.target.value);
              setDiagnostics([]);
            }}
          />
        </label>
        <label htmlFor={`${diagnosticId}-reason`}>
          修改原因
          <Textarea
            id={`${diagnosticId}-reason`}
            aria-label="修改原因"
            value={draftReason}
            disabled={!canEdit || validating}
            onChange={(event) => {
              setDraftReason(event.target.value);
              setDiagnostics([]);
            }}
          />
        </label>
        <button
          type="button"
          className="button subtle"
          disabled={!canEdit || validating || !draftReason.trim()}
          onClick={() => submitDraft("set")}
        >
          {validating ? "创建中…" : "校验并创建草稿"}
        </button>
        <button
          type="button"
          className="button subtle"
          disabled={!canEdit || validating || !draftReason.trim()}
          onClick={() => submitDraft("delete")}
        >
          创建删除草稿
        </button>
        {diagnostics.length > 0 ? (
          <ul id={diagnosticId} aria-label="编辑诊断" role="alert">
            {diagnostics.map((item) => (
              <li key={`${item.code ?? ""}:${item.message}`}>{presentError(new Error(item.message), "目标值未通过校验，请检查格式、范围及来源版本后重试。")}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {openMappings.length > 0 ? (
        <section aria-label="节点对应提示">
          <h4>关联节点对应</h4>
          <p>存在 {openMappings.length} 个未解决节点对应，发布前须完成确认。</p>
        </section>
      ) : null}
    </Wrapper>
  );
}
