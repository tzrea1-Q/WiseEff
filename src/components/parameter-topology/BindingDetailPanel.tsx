import { useState } from "react";
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

export type BindingDetailPanelProps = {
  binding: ProjectParameterBinding;
  view: TopologyView;
  sourceNode?: SourceTopologyNode | null;
  effects?: EffectiveTopologyEffect[];
  provenanceLabels?: string[];
  mappingTasks?: IdentityMappingTask[];
  canEdit?: boolean;
  onValidateEdit?: (input: { bindingId: string; rawValue: string }) => BindingEditValidation;
  asDialog?: boolean;
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
  asDialog = false
}: BindingDetailPanelProps) {
  const [draftRaw, setDraftRaw] = useState(binding.rawValue);
  const [diagnostics, setDiagnostics] = useState<TopologyDiagnostic[]>([]);

  const openMappings = mappingTasks.filter((task) => task.status === "open");
  const Wrapper: "section" | "div" = asDialog ? "div" : "section";
  const wrapperProps = asDialog
    ? {}
    : {
        role: "region" as const,
        "aria-label": "绑定详情",
        "data-binding-id": binding.id
      };

  return (
    <Wrapper className="binding-detail-panel" {...wrapperProps} data-binding-id={binding.id}>
      <header className="binding-detail-panel__header">
        <h3>
          {binding.propertyKey}
          {binding.driverModule ? <small> · {binding.driverModule}</small> : null}
        </h3>
        <p>
          {binding.instanceName ?? "—"} · {binding.locator ?? "—"}
        </p>
      </header>

      <dl className="binding-detail-panel__meta">
        <div>
          <dt>绑定 ID</dt>
          <dd>
            <code>{binding.id}</code>
          </dd>
        </div>
        <div>
          <dt>规格版本</dt>
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
            <p>power.dtso · gpio_int · set</p>
          )}
        </section>
      )}

      <section aria-label="类型化编辑">
        <h4>类型化编辑</h4>
        <label>
          目标值 / raw
          <textarea
            aria-label="目标值 raw"
            value={draftRaw}
            disabled={!canEdit}
            onChange={(event) => {
              setDraftRaw(event.target.value);
              setDiagnostics([]);
            }}
          />
        </label>
        <button
          type="button"
          className="button subtle"
          disabled={!canEdit}
          onClick={() => {
            const result = onValidateEdit?.({ bindingId: binding.id, rawValue: draftRaw }) ?? {
              valid: true,
              diagnostics: []
            };
            setDiagnostics(result.diagnostics);
          }}
        >
          校验 / 应用诊断
        </button>
        {diagnostics.length > 0 ? (
          <ul aria-label="编辑诊断">
            {diagnostics.map((item) => (
              <li key={`${item.code ?? ""}:${item.message}`}>{item.message}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {openMappings.length > 0 ? (
        <section aria-label="绑定映射提示">
          <h4>关联映射</h4>
          <p>存在 {openMappings.length} 个未解决映射，发布前须完成审核。</p>
        </section>
      ) : null}
    </Wrapper>
  );
}
