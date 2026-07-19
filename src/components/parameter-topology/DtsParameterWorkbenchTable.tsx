import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

export type DtsParameterWorkbenchTableProps = {
  rows: DtsParameterWorkbenchRow[];
  selectedBindingId: string | null;
  draftBindingIds: ReadonlySet<string>;
  canEdit: boolean;
  onSelectBinding: (bindingId: string) => void;
  onEditBinding?: (bindingId: string) => void;
};

const governanceLabels = {
  valid: "有效 · valid",
  attention: "待处理 · attention",
  blocked: "阻断 · blocked"
} as const;

function DeviceIdentity({ row }: { row: DtsParameterWorkbenchRow }) {
  return (
    <span className="dts-parameter-workbench-table__identity">
      <strong>{row.driverModule ?? row.compatible ?? "未关联驱动"}</strong>
      {row.instanceName ? <code>{row.instanceName}</code> : null}
      {row.compatible && row.compatible !== row.driverModule ? (
        <small>{row.compatible}</small>
      ) : null}
    </span>
  );
}

function Governance({ row }: { row: DtsParameterWorkbenchRow }) {
  return (
    <span className="dts-parameter-workbench-table__governance">
      <span
        className={`dts-parameter-workbench-table__governance-badge is-${row.governanceState}`}
        aria-label={`治理状态：${row.governanceState}`}
      >
        {governanceLabels[row.governanceState]}
      </span>
      <small>schema: {row.schemaState}</small>
      <small>policy: {row.policyState}</small>
      {row.mappingOpen ? <small>mapping: open</small> : null}
    </span>
  );
}

/**
 * One semantic row structure serves both the desktop grid and the responsive card layout.
 * CSS may change its visual flow without duplicating accessible rows or binding actions.
 */
export function DtsParameterWorkbenchTable({
  rows,
  selectedBindingId,
  draftBindingIds,
  canEdit,
  onSelectBinding,
  onEditBinding
}: DtsParameterWorkbenchTableProps) {
  return (
    <div role="table" aria-label="DTS 参数列表" className="dts-parameter-workbench-table">
      <div role="rowgroup" className="dts-parameter-workbench-table__head">
        <div role="row" className="dts-parameter-workbench-table__header-row">
          {[
            "属性",
            "器件 / 驱动",
            "DTS 位置",
            "生效值",
            "类型",
            "治理",
            "操作"
          ].map((label) => (
            <span role="columnheader" key={label}>{label}</span>
          ))}
        </div>
      </div>
      <div role="rowgroup" className="dts-parameter-workbench-table__body">
        {rows.map((row) => {
          const isDraft = draftBindingIds.has(row.bindingId);
          const isSelected = selectedBindingId === row.bindingId;
          return (
            <article
              role="row"
              key={row.bindingId}
              data-binding-id={row.bindingId}
              aria-selected={isSelected}
              className={`dts-parameter-workbench-table__row dts-parameter-workbench-table__card${isSelected ? " is-selected" : ""}`}
            >
              <span role="cell" data-label="属性" className="dts-parameter-workbench-table__property">
                <code>{row.propertyKey}</code>
                {isDraft ? (
                  <span
                    className="dts-parameter-workbench-table__draft-badge"
                    data-testid={`draft-${row.bindingId}`}
                  >
                    草稿
                  </span>
                ) : null}
              </span>
              <span role="cell" data-label="器件 / 驱动">
                <DeviceIdentity row={row} />
              </span>
              <span role="cell" data-label="DTS 位置">
                <code title={row.topologyPath ?? undefined}>{row.topologyPath ?? "位置不可用"}</code>
              </span>
              <span role="cell" data-label="生效值">
                <code title={row.rawValue}>{row.rawValue}</code>
              </span>
              <span role="cell" data-label="类型">
                {row.valueShapeSummary}
              </span>
              <span role="cell" data-label="治理">
                <Governance row={row} />
              </span>
              <span role="cell" data-label="操作" className="dts-parameter-workbench-table__actions">
                <button
                  type="button"
                  className="button subtle"
                  aria-label={`查看 ${row.propertyKey}`}
                  onClick={() => onSelectBinding(row.bindingId)}
                >
                  查看
                </button>
                {canEdit ? (
                  <button
                    type="button"
                    className="button"
                    aria-label={`编辑 ${row.propertyKey}`}
                    onClick={() => {
                      onSelectBinding(row.bindingId);
                      onEditBinding?.(row.bindingId);
                    }}
                  >
                    {isDraft ? "继续编辑" : "编辑"}
                  </button>
                ) : null}
              </span>
            </article>
          );
        })}
      </div>
    </div>
  );
}
