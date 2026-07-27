import { useMemo, useState } from "react";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { ColumnFilter } from "@/components/ColumnFilter";
import type { UnmappedCompatibleHint } from "@/domain/parameter-topology/moduleDiscovery";

export type UnclassifiedCompatibleQueueProps = {
  hints: readonly UnmappedCompatibleHint[];
  canAdmin?: boolean;
  busy?: boolean;
  selectedCompatibles: readonly string[];
  onSelectionChange: (next: string[]) => void;
  onClassify: (hints: UnmappedCompatibleHint[]) => void;
  onDismiss: (compatible: string) => void;
};

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function toggleValue(selected: readonly string[], value: string): string[] {
  return selected.includes(value)
    ? selected.filter((item) => item !== value)
    : [...selected, value];
}

/**
 * Emptiable unclassified-compatible work queue for module attribution (PR2).
 */
export function UnclassifiedCompatibleQueue({
  hints,
  canAdmin = false,
  busy = false,
  selectedCompatibles,
  onSelectionChange,
  onClassify,
  onDismiss
}: UnclassifiedCompatibleQueueProps) {
  const [compatibleFilter, setCompatibleFilter] = useState<string[]>([]);
  const [suggestedFilter, setSuggestedFilter] = useState<string[]>([]);

  const compatibleValues = useMemo(
    () => uniqueValues(hints.map((hint) => hint.compatible)),
    [hints]
  );
  const suggestedValues = useMemo(
    () => uniqueValues(hints.map((hint) => hint.suggestedGroupName)),
    [hints]
  );

  const visibleHints = useMemo(() => {
    return hints.filter((hint) => {
      if (compatibleFilter.length > 0 && !compatibleFilter.includes(hint.compatible)) {
        return false;
      }
      if (suggestedFilter.length > 0 && !suggestedFilter.includes(hint.suggestedGroupName)) {
        return false;
      }
      return true;
    });
  }, [compatibleFilter, hints, suggestedFilter]);

  const selectedSet = useMemo(() => new Set(selectedCompatibles), [selectedCompatibles]);
  const allVisibleSelected =
    visibleHints.length > 0 && visibleHints.every((hint) => selectedSet.has(hint.compatible));
  const selectedHints = hints.filter((hint) => selectedSet.has(hint.compatible));

  return (
    <section
      className="unclassified-compatible-queue"
      aria-labelledby="unclassified-compatible-queue-title"
    >
      <div className="unclassified-compatible-queue__head">
        <div>
          <h4 id="unclassified-compatible-queue-title">
            {PARAMETER_ADMIN_UI.moduleDiscoveryCompatible}
          </h4>
          <p className="muted">
            {hints.length === 0
              ? PARAMETER_ADMIN_UI.moduleDiscoveryCompatibleEmpty
              : `共 ${hints.length} 项待归类`}
          </p>
        </div>
        {canAdmin && selectedHints.length > 0 ? (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => onClassify(selectedHints)}
          >
            {PARAMETER_ADMIN_UI.classifyCompatibleBulk}（{selectedHints.length}）
          </button>
        ) : null}
      </div>

      {hints.length === 0 ? null : (
        <div className="param-admin-library-table">
          <table className="parameter-spec-library-grid param-admin-library-grid unclassified-compatible-queue__table">
            <thead>
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="全选可见行"
                    checked={allVisibleSelected}
                    disabled={busy || visibleHints.length === 0}
                    onChange={() => {
                      if (allVisibleSelected) {
                        const visible = new Set(visibleHints.map((hint) => hint.compatible));
                        onSelectionChange(
                          selectedCompatibles.filter((value) => !visible.has(value))
                        );
                      } else {
                        onSelectionChange(
                          uniqueValues([
                            ...selectedCompatibles,
                            ...visibleHints.map((hint) => hint.compatible)
                          ])
                        );
                      }
                    }}
                  />
                </th>
                <th scope="col">
                  <div className="table-header-with-filter">
                    <span>{PARAMETER_ADMIN_UI.queueColCompatible}</span>
                    <ColumnFilter
                      label={PARAMETER_ADMIN_UI.queueColCompatible}
                      groupLabel={PARAMETER_ADMIN_UI.queueColCompatible}
                      values={compatibleValues}
                      selectedValues={compatibleFilter}
                      onToggle={(value) =>
                        setCompatibleFilter((current) => toggleValue(current, value))
                      }
                      onClear={() => setCompatibleFilter([])}
                    />
                  </div>
                </th>
                <th scope="col">{PARAMETER_ADMIN_UI.queueColBindings}</th>
                <th scope="col">{PARAMETER_ADMIN_UI.queueColProjects}</th>
                <th scope="col">
                  <div className="table-header-with-filter">
                    <span>{PARAMETER_ADMIN_UI.queueColSuggested}</span>
                    <ColumnFilter
                      label={PARAMETER_ADMIN_UI.queueColSuggested}
                      groupLabel={PARAMETER_ADMIN_UI.queueColSuggested}
                      values={suggestedValues}
                      selectedValues={suggestedFilter}
                      onToggle={(value) =>
                        setSuggestedFilter((current) => toggleValue(current, value))
                      }
                      onClear={() => setSuggestedFilter([])}
                    />
                  </div>
                </th>
                <th scope="col">{PARAMETER_ADMIN_UI.queueColActions}</th>
              </tr>
            </thead>
            <tbody>
              {visibleHints.length === 0 ? (
                <tr>
                  <td colSpan={6}>没有匹配的队列项。</td>
                </tr>
              ) : (
                visibleHints.map((hint) => (
                  <tr key={hint.compatible}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择 ${hint.compatible}`}
                        checked={selectedSet.has(hint.compatible)}
                        disabled={busy}
                        onChange={() =>
                          onSelectionChange(toggleValue(selectedCompatibles, hint.compatible))
                        }
                      />
                    </td>
                    <td>
                      <code>{hint.compatible}</code>
                    </td>
                    <td>{hint.bindingCount}</td>
                    <td>{hint.projectCount}</td>
                    <td>{hint.suggestedGroupName}</td>
                    <td>
                      <div className="param-admin-row-actions">
                        {canAdmin ? (
                          <>
                            <button
                              type="button"
                              className="button subtle"
                              disabled={busy}
                              onClick={() => onClassify([hint])}
                            >
                              {PARAMETER_ADMIN_UI.classifyCompatible}
                            </button>
                            <button
                              type="button"
                              className="button subtle"
                              disabled={busy}
                              onClick={() => onDismiss(hint.compatible)}
                            >
                              {PARAMETER_ADMIN_UI.dismissCompatible}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
