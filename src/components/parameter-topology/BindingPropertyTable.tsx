import type { ProjectParameterBinding } from "@/domain/parameter-topology/types";

function formatEffectiveValue(binding: ProjectParameterBinding): string {
  if (binding.rawValue.trim()) {
    return binding.rawValue;
  }
  const value = binding.effectiveValue;
  if (value.kind === "empty") {
    return "—";
  }
  if (value.kind === "boolean") {
    return value.present ? "true" : "false";
  }
  if (value.kind === "strings") {
    return value.values.map((item) => `"${item}"`).join(", ");
  }
  if (value.kind === "bytes") {
    return `[${value.values.join(" ")}]`;
  }
  if (value.kind === "cells") {
    return value.groups
      .map(
        (group) =>
          `<${group
            .map((cell) => (cell.kind === "phandle" ? `&${cell.label}` : cell.raw))
            .join(" ")}>`
      )
      .join(" ");
  }
  return JSON.stringify(value);
}

export type BindingPropertyTableProps = {
  bindings: ProjectParameterBinding[];
  selectedBindingId: string | null;
  onSelectBinding: (bindingId: string) => void;
  searchQuery: string;
};

export function BindingPropertyTable({
  bindings,
  selectedBindingId,
  onSelectBinding,
  searchQuery
}: BindingPropertyTableProps) {
  const needle = searchQuery.trim().toLocaleLowerCase();
  const rows = needle
    ? bindings.filter((binding) => {
        const haystack = [
          binding.propertyKey,
          binding.driverModule ?? "",
          binding.instanceName ?? "",
          binding.locator ?? "",
          binding.rawValue
        ]
          .join(" ")
          .toLocaleLowerCase();
        return haystack.includes(needle);
      })
    : bindings;

  return (
    <div className="binding-property-table">
      <table>
        <thead>
          <tr>
            <th scope="col">属性键</th>
            <th scope="col">驱动</th>
            <th scope="col">实例</th>
            <th scope="col">生效值</th>
            <th scope="col">Schema</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((binding) => (
            <tr
              key={binding.id}
              data-binding-id={binding.id}
              className={selectedBindingId === binding.id ? "is-selected" : undefined}
              onClick={() => onSelectBinding(binding.id)}
            >
              <td role="cell">{binding.propertyKey}</td>
              <td>{binding.driverModule ?? "—"}</td>
              <td>{binding.instanceName ?? "—"}</td>
              <td>
                <code>{formatEffectiveValue(binding)}</code>
              </td>
              <td>{binding.schemaState}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="binding-property-table__empty">无匹配绑定。</p> : null}
    </div>
  );
}
