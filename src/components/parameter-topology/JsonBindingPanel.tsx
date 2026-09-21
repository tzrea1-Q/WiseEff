import { useMemo, useState } from "react";
import type { ProjectParameterBinding } from "@/domain/parameter-topology/types";
import type { BindingEditInput, BindingEditValidation } from "./BindingDetailPanel";
import { BindingDetailPanel } from "./BindingDetailPanel";
import { formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";

export type JsonBindingPanelProps = {
  bindings: readonly ProjectParameterBinding[];
  canEdit?: boolean;
  onValidateEdit?: (input: BindingEditInput) =>
    | BindingEditValidation
    | Promise<BindingEditValidation>;
  onExportBinding?: (bindingId: string) => Promise<void>;
  onLoadHistory?: (bindingId: string) => Promise<readonly JsonBindingHistoryEntry[]>;
};

export type JsonBindingHistoryEntry = {
  id: string;
  reason: string;
  createdAt: string;
  oldCurrentValueId: string | null;
  newCurrentValueId: string | null;
  valueState?: "present" | "deleted" | null;
};

/** JSON bindings stay outside the DTS workbench; their source text is never parsed as a DtsValue. */
export function JsonBindingPanel({
  bindings,
  canEdit = false,
  onValidateEdit,
  onExportBinding,
  onLoadHistory
}: JsonBindingPanelProps) {
  const jsonBindings = useMemo(
    () => bindings.filter((binding) => binding.effectiveValue.kind === "json"),
    [bindings]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly JsonBindingHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const selected = jsonBindings.find((binding) => binding.id === selectedId) ?? jsonBindings[0] ?? null;

  const loadHistory = () => {
    if (!selected || !onLoadHistory) return;
    setHistoryLoading(true);
    setHistoryError(null);
    void onLoadHistory(selected.id)
      .then(setHistory)
      .catch(() => setHistoryError("固定值历史加载失败，请稍后重试。"))
      .finally(() => setHistoryLoading(false));
  };

  if (jsonBindings.length === 0) return null;

  return (
    <section className="project-topology-workspace__json" aria-label="JSON 参数">
      <header>
        <h2>JSON 参数</h2>
        <p>编辑 JSON 值，审核通过后更新对应源文件。</p>
      </header>
      <div className="table-wrap">
        <table aria-label="JSON 参数列表">
          <thead>
            <tr>
              <th>属性</th>
              <th>实例 / 定位</th>
              <th>当前 JSON</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {jsonBindings.map((binding) => (
              <tr key={binding.id}>
                <td><code>{binding.propertyKey}</code></td>
                <td>{binding.instanceName ?? "—"} · {binding.locator ?? "—"}</td>
                <td><pre>{binding.rawValue}</pre></td>
                <td>
                  <button type="button" className="button subtle" onClick={() => setSelectedId(binding.id)}>
                    查看 / 编辑
                  </button>{" "}
                  {onExportBinding ? (
                    <button
                      type="button"
                      className="button subtle"
                      disabled={exportingId === binding.id}
                      onClick={() => {
                        setExportingId(binding.id);
                        setExportError(null);
                        void onExportBinding(binding.id)
                          .catch(() => setExportError("固定源导出失败，请稍后重试。"))
                          .finally(() => setExportingId(null));
                      }}
                    >
                      {exportingId === binding.id ? "导出中…" : "导出源文件"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {exportError ? <p role="alert">{exportError}</p> : null}
      {selected ? (
        <>
          <BindingDetailPanel
            binding={selected}
            view="source"
            canEdit={canEdit}
            onValidateEdit={onValidateEdit}
          />
          {onLoadHistory ? (
            <section aria-label="JSON 参数历史" className="binding-detail-panel__history">
              <button type="button" className="button subtle" onClick={loadHistory} disabled={historyLoading}>
                {historyLoading ? "加载历史中…" : "查看固定值历史"}
              </button>
              {historyError ? <p role="alert">{historyError}</p> : null}
              {history.length > 0 ? (
                <ol>
                  {history.map((entry) => (
                    <li key={entry.id}>
                      <time dateTime={entry.createdAt}>{formatRelativeOrAbsolute(entry.createdAt)}</time> · {entry.valueState === "deleted"
                        ? "删除属性 · " : entry.valueState === "present" ? "更新属性 · " : ""}{entry.reason}
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
