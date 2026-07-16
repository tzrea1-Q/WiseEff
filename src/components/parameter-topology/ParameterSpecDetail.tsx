import type { ParameterSpecLibraryRow } from "./ParameterSpecLibrary";

export type SpecUsageEntry = {
  projectCode: string;
  instanceName: string | null;
};

export type SpecSchemaHistoryEntry = {
  version: number;
  source: string;
  note?: string;
};

export type ParameterSpecDetailView = ParameterSpecLibraryRow & {
  schemaDefault?: unknown;
  policyTarget?: unknown;
  usage?: SpecUsageEntry[];
  schemaHistory?: SpecSchemaHistoryEntry[];
};

function formatValue(value: unknown): string {
  if (value == null) {
    return "—";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export type ParameterSpecDetailProps = {
  detail: ParameterSpecDetailView;
};

export function ParameterSpecDetail({ detail }: ParameterSpecDetailProps) {
  return (
    <section className="parameter-spec-detail" aria-label="规格详情">
      <header className="parameter-spec-detail__header">
        <h3>
          {detail.propertyKey}
          {detail.driverModule ? <small> · {detail.driverModule}</small> : null}
        </h3>
        <p>
          {detail.compatible ?? "—"} · {detail.valueType} · {detail.schemaSource}/{detail.schemaVersion ?? "—"}
        </p>
      </header>

      <dl className="parameter-spec-detail__fields">
        <div>
          <dt>Schema 默认值</dt>
          <dd>
            <code>{formatValue(detail.schemaDefault)}</code>
          </dd>
        </div>
        <div>
          <dt>示例值</dt>
          <dd>
            <code>{formatValue(detail.exampleValue)}</code>
            <small>仅作示例，不参与校验或初始化</small>
          </dd>
        </div>
        <div>
          <dt>策略目标</dt>
          <dd>
            <code>{formatValue(detail.policyTarget)}</code>
          </dd>
        </div>
        <div>
          <dt>业务分类</dt>
          <dd>{detail.businessCategory ?? "—"}</dd>
        </div>
        <div>
          <dt>审核状态</dt>
          <dd>{detail.reviewState}</dd>
        </div>
      </dl>

      <section aria-label="使用情况">
        <h4>使用情况</h4>
        {detail.usage && detail.usage.length > 0 ? (
          <ul>
            {detail.usage.map((entry) => (
              <li key={`${entry.projectCode}:${entry.instanceName ?? ""}`}>
                {entry.projectCode}
                {entry.instanceName ? ` · ${entry.instanceName}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p>暂无项目绑定</p>
        )}
      </section>

      <section aria-label="Schema 历史">
        <h4>Schema 历史</h4>
        {detail.schemaHistory && detail.schemaHistory.length > 0 ? (
          <ol>
            {detail.schemaHistory.map((entry) => (
              <li key={`${entry.version}-${entry.source}`}>
                v{entry.version} · {entry.source}
                {entry.note ? ` — ${entry.note}` : ""}
              </li>
            ))}
          </ol>
        ) : (
          <p>暂无版本历史</p>
        )}
      </section>
    </section>
  );
}
