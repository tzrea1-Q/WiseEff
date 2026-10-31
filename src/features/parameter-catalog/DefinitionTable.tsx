import type { ReactNode } from "react";
import { DataTable, type Column } from "@/components/admin";
import type { CatalogDefinitionResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { catalogLifecycleLabel } from "./catalogPresentation";
import { catalogDefinitionsLabel } from "./copy";

type Definition = CatalogDefinitionResponse["item"];

export function DefinitionTable({ rows, columns, compact, selectedDefinitionId, onOpen, canEdit, ownerStatusLabel,
  renderActions, emptyState, selectedIds, onSelectionChange }: {
  rows: Definition[];
  columns: Column<Definition>[];
  compact: boolean;
  selectedDefinitionId?: string;
  onOpen: (definition: Definition) => void;
  canEdit: (definition: Definition) => boolean;
  ownerStatusLabel: (definition: Definition) => string | null;
  renderActions: (definition: Definition) => ReactNode;
  emptyState?: ReactNode;
  selectedIds?: readonly string[];
  onSelectionChange?: (definition: Definition, selected: boolean) => void;
}) {
  const checkbox = (row: Definition) => onSelectionChange ? <input type="checkbox"
    aria-label={`选择 ${row.propertyKey}`} checked={selectedIds?.includes(row.id) ?? false}
    onClick={(event) => event.stopPropagation()}
    onChange={(event) => onSelectionChange(row, event.target.checked)} /> : null;
  if (compact) return <div className="parameter-catalog__cards parameter-catalog__table-wrap--mobile">
    {rows.map((item) => <div key={item.id} className="parameter-catalog__card-row">
      {checkbox(item)}
      <button type="button" className="parameter-catalog__card" aria-pressed={item.id === selectedDefinitionId}
        onClick={() => onOpen(item)}>
        <code className="parameter-catalog__subject-name">{item.propertyKey}</code>
        <span>{item.currentRevision.displayName || "—"}</span>
        <span className="parameter-catalog__subject-meta">{item.subject.canonicalName} · {catalogLifecycleLabel(item.lifecycle)}{ownerStatusLabel(item) ? ` · ${ownerStatusLabel(item)}` : ""}</span>
      </button>
      <button type="button" className="button subtle sm" aria-label={`${canEdit(item) ? "编辑" : "查看"} ${item.propertyKey}`}
        data-catalog-row-action={canEdit(item) ? "edit" : "read"} onClick={() => onOpen(item)}>{canEdit(item) ? "编辑" : "查看"}</button>
      {renderActions(item)}
    </div>)}
  </div>;
  return <div className="parameter-catalog__table-wrap--desktop">
    <DataTable rows={rows} rowKey={(row) => row.id}
      columns={onSelectionChange ? [{ key: "selection", header: "选择", render: checkbox }, ...columns] : columns}
      tableClassName="parameter-catalog__table" selectedRowKey={selectedDefinitionId} onRowClick={onOpen}
      aria-label={catalogDefinitionsLabel} pageSize={Math.max(rows.length, 1)} renderRowActions={renderActions} emptyState={emptyState} />
  </div>;
}
