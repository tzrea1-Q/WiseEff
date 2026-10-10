import { X } from "lucide-react";

import type { KnowledgeParameterReference } from "@/domain/knowledge/types";
import { definitionReferenceLifecycleLabels, parameterSpecReferenceLifecycleLabels } from "@/domain/knowledge/types";

export function referenceDisplayName(reference: Pick<KnowledgeParameterReference, "displayName" | "propertyKey">) {
  return reference.displayName?.trim() || reference.propertyKey || "定义不可用";
}

/**
 * Definition chips for a knowledge entry: name, module, and an honest
 * lifecycle badge — deprecated definitions show 已废弃 (ADR-0011) while the
 * reference itself survives. Clicking deep-links into the definition surface.
 */
export function KnowledgeParameterReferenceChips({
  references,
  onOpenDefinition,
  onRemove,
  removePendingSpecId = null
}: {
  references: KnowledgeParameterReference[];
  onOpenDefinition?: (definitionId: string) => void;
  /** Present in the editor: renders a per-chip remove control. */
  onRemove?: (reference: KnowledgeParameterReference) => void;
  removePendingSpecId?: string | null;
}) {
  if (references.length === 0) {
    return null;
  }
  return (
    <ul className="knowledge-parameter-reference-chips">
      {references.map((reference) => {
        const canonical = reference.kind === "definition";
        const identity = canonical ? reference.definitionId : reference.specId;
        const name = referenceDisplayName(reference);
        const label = reference.driverModule ? `${name} · ${reference.driverModule}` : name;
        const mappingStatus = canonical ? undefined : reference.mappingStatus;
        const historicalOnly = !canonical && Boolean(reference.historicalOnly || mappingStatus === "historical");
        const orphaned = mappingStatus === "orphaned" || mappingStatus === "unmapped";
        const archived = mappingStatus === "archived";
        const unavailable = canonical && reference.availability === "unavailable";
        const unavailableReason = canonical
          ? unavailable
            ? "当前会话无法读取该定义，引用保留但无法打开。"
            : !onOpenDefinition ? "当前会话未提供可访问的参数定义读取入口。" : undefined
          : undefined;
        const statusLabel = unavailable
          ? "不可用"
          : orphaned
          ? "旧引用不可用"
          : archived
            ? "已归档"
            : historicalOnly
              ? "历史"
              : canonical
                ? definitionReferenceLifecycleLabels[reference.lifecycle!]
                : parameterSpecReferenceLifecycleLabels[reference.lifecycle];
        const statusClass = unavailable || orphaned || archived
          ? "is-deprecated"
          : historicalOnly
            ? "is-draft"
            : `is-${reference.lifecycle}`;
        return (
          <li
            key={`${canonical ? "definition" : "legacy-spec"}:${identity}`}
            className="knowledge-parameter-reference-chip"
            data-definition-id={canonical ? identity : undefined}
            data-spec-id={canonical ? undefined : identity}
            data-mapping-status={unavailable ? "unavailable" : mappingStatus ?? (historicalOnly ? "historical" : canonical ? "current" : "legacy-spec")}
            data-historical={historicalOnly ? "true" : "false"}
          >
            {canonical && !unavailable && onOpenDefinition ? (
              <button
                type="button"
                className="knowledge-parameter-reference-chip__link"
                title={`查看参数定义 ${reference.propertyKey}`}
                onClick={() => onOpenDefinition(identity)}
              >
                {label}
              </button>
            ) : (
              <span
                className="knowledge-parameter-reference-chip__link"
                title={unavailableReason}
                aria-label={unavailableReason ? `${label}。${unavailableReason}` : undefined}
              >{label}</span>
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
                disabled={removePendingSpecId === identity}
                onClick={() => onRemove(reference)}
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
