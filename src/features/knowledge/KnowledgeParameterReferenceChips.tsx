import { X } from "lucide-react";

import type { KnowledgeParameterReference } from "@/domain/knowledge/types";
import { parameterSpecReferenceLifecycleLabels } from "@/domain/knowledge/types";

type KnowledgeReferenceChip = KnowledgeParameterReference & {
  historicalOnly?: boolean;
  mappingStatus?: "current" | "historical" | "orphaned" | "archived" | "unmapped";
};

export function referenceDisplayName(reference: Pick<KnowledgeParameterReference, "displayName" | "propertyKey">) {
  return reference.displayName?.trim() || reference.propertyKey;
}

/**
 * Definition chips for a knowledge entry: name, module, and an honest
 * lifecycle badge — deprecated definitions show 已废弃 (ADR-0011) while the
 * reference itself survives. Clicking deep-links into the definition surface.
 */
export function KnowledgeParameterReferenceChips({
  references,
  onOpenSpec,
  onRemove,
  removePendingSpecId = null
}: {
  references: KnowledgeReferenceChip[];
  onOpenSpec?: (specId: string) => void;
  /** Present in the editor: renders a per-chip remove control. */
  onRemove?: (specId: string) => void;
  removePendingSpecId?: string | null;
}) {
  if (references.length === 0) {
    return null;
  }
  return (
    <ul className="knowledge-parameter-reference-chips">
      {references.map((reference) => {
        const name = referenceDisplayName(reference);
        const label = reference.driverModule ? `${name} · ${reference.driverModule}` : name;
        const mappingStatus = reference.mappingStatus;
        const historicalOnly = Boolean(reference.historicalOnly || mappingStatus === "historical");
        const orphaned = mappingStatus === "orphaned";
        const archived = mappingStatus === "archived";
        const statusLabel = orphaned
          ? "缺失映射"
          : archived
            ? "已归档"
            : historicalOnly
              ? "历史"
              : parameterSpecReferenceLifecycleLabels[reference.lifecycle];
        const statusClass = orphaned || archived
          ? "is-deprecated"
          : historicalOnly
            ? "is-draft"
            : `is-${reference.lifecycle}`;
        return (
          <li
            key={reference.specId}
            className="knowledge-parameter-reference-chip"
            data-spec-id={reference.specId}
            data-mapping-status={mappingStatus ?? (historicalOnly ? "historical" : "current")}
            data-historical={historicalOnly ? "true" : "false"}
          >
            {onOpenSpec ? (
              <button
                type="button"
                className="knowledge-parameter-reference-chip__link"
                title={`查看参数定义 ${reference.propertyKey}`}
                onClick={() => onOpenSpec(reference.specId)}
              >
                {label}
              </button>
            ) : (
              <span className="knowledge-parameter-reference-chip__link">{label}</span>
            )}
            <span
              className={`knowledge-parameter-reference-chip__lifecycle ${statusClass}`}
              data-lifecycle={reference.lifecycle}
            >
              {statusLabel}
            </span>
            {onRemove ? (
              <button
                type="button"
                className="knowledge-parameter-reference-chip__remove"
                aria-label={`移除引用 ${name}`}
                disabled={removePendingSpecId === reference.specId}
                onClick={() => onRemove(reference.specId)}
              >
                <X size={12} strokeWidth={2} aria-hidden="true" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
