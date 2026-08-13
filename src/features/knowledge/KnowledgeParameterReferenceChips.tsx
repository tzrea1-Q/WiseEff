import { X } from "lucide-react";

import type { KnowledgeParameterReference } from "@/domain/knowledge/types";
import { parameterSpecReferenceLifecycleLabels } from "@/domain/knowledge/types";

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
  references: KnowledgeParameterReference[];
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
        return (
          <li key={reference.specId} className="knowledge-parameter-reference-chip" data-spec-id={reference.specId}>
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
              className={`knowledge-parameter-reference-chip__lifecycle is-${reference.lifecycle}`}
              data-lifecycle={reference.lifecycle}
            >
              {parameterSpecReferenceLifecycleLabels[reference.lifecycle]}
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
