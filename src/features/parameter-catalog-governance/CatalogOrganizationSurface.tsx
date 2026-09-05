import { useCallback, useState } from "react";

import {
  catalogActorForRole,
  type CatalogActorKind,
  type CatalogAuthorizedAction,
  type CatalogDomainState
} from "@/application/parameter-catalog";
import { buildCatalogHref, parseCatalogUrlAnchor } from "@/application/parameter-catalog/urlAnchor";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { CatalogPage } from "@/features/parameter-catalog";

import { createGovernanceIdempotencyKey } from "./governanceState";
import { ProposalPanel } from "./ProposalPanel";
import { RegistrationDialog } from "./RegistrationDialog";
import { ReviewQueue } from "./ReviewQueue";

export type CatalogOrganizationSurfaceProps = {
  catalog: ParameterCatalogRepository;
  governance: ParameterCatalogGovernanceRepository;
  actor?: CatalogActorKind;
  roleId?: string;
  search: string;
  onAnchorChange: (href: string, mode: "push" | "replace") => void;
  organizationId?: string;
  currentPersonId: string;
};

export function CatalogOrganizationSurface({
  catalog,
  governance,
  actor: actorProp,
  roleId,
  search,
  onAnchorChange,
  organizationId,
  currentPersonId
}: CatalogOrganizationSurfaceProps) {
  const actor = actorProp ?? catalogActorForRole(roleId ?? "");
  const anchor = parseCatalogUrlAnchor(search);
  const [domainState, setDomainState] = useState<CatalogDomainState | null>(null);
  const [action, setAction] = useState<CatalogAuthorizedAction | null>(null);
  const catalogReleaseId = domainState?.catalogReleaseId ?? anchor.catalogReleaseId ?? "";
  const subjectId = anchor.subjectId ?? "";

  const handleAction = useCallback((next: CatalogAuthorizedAction) => {
    if (next === "register-subject" || next === "update-placement") {
      setAction(next);
    }
  }, []);

  const handleSelectReviewItem = useCallback(
    (id: string | null) => {
      onAnchorChange(
        buildCatalogHref({
          ...anchor,
          reviewItemId: id
        }),
        "push"
      );
    },
    [anchor, onAnchorChange]
  );

  return (
    <div className="parameter-catalog-organization">
      <CatalogPage
        repository={catalog}
        actor={actor}
        search={search}
        onAnchorChange={onAnchorChange}
        onDomainStateChange={setDomainState}
        onAction={handleAction}
        organizationId={organizationId}
        listReviewItems={
          organizationId ? (orgId, query) => governance.listReviewItems(orgId, query) : undefined
        }
      />
      {domainState && catalogReleaseId && organizationId ? (
        <div className="parameter-catalog__governance">
          <ReviewQueue
            actor={actor}
            domainState={domainState}
            repository={governance}
            organizationId={organizationId}
            catalogReleaseId={catalogReleaseId}
            selectedReviewItemId={anchor.reviewItemId ?? undefined}
            onSelectReviewItem={handleSelectReviewItem}
          />
          <ProposalPanel
            actor={actor}
            domainState={domainState}
            repository={governance}
            catalogReleaseId={catalogReleaseId}
            currentPersonId={currentPersonId}
            definitionId={anchor.definitionId ?? undefined}
            createIdempotencyKey={createGovernanceIdempotencyKey}
          />
        </div>
      ) : null}
      {organizationId &&
      catalogReleaseId &&
      domainState &&
      subjectId &&
      (action === "register-subject" || action === "update-placement") ? (
        <RegistrationDialog
          open
          intent={action}
          actor={actor}
          domainState={domainState}
          repository={governance}
          organizationId={organizationId}
          subjectId={subjectId}
          catalogReleaseId={catalogReleaseId}
          createIdempotencyKey={createGovernanceIdempotencyKey}
          onOpenChange={(open) => {
            if (!open) {
              setAction(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}
