import { useCallback, useEffect, useState } from "react";

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
import { PublicationDialog } from "./PublicationDialog";
import { publicationSurfaceCopy, publicationSurfaceMessage, type PublicationSurfaceItem } from "./publicationSurface";
import { RegistrationDialog } from "./RegistrationDialog";
import { ReviewQueue } from "./ReviewQueue";
import type { CatalogPublicationJobResponse } from "@/infrastructure/http/parameterCatalogDtos";

export type CatalogOrganizationSurfaceProps = {
  catalog: ParameterCatalogRepository;
  governance: ParameterCatalogGovernanceRepository;
  actor?: CatalogActorKind;
  roleId?: string;
  sessionPermissions?: readonly string[] | null;
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
  sessionPermissions,
  search,
  onAnchorChange,
  organizationId,
  currentPersonId
}: CatalogOrganizationSurfaceProps) {
  const actor = actorProp ?? catalogActorForRole(roleId ?? "");
  const anchor = parseCatalogUrlAnchor(search);
  const [domainState, setDomainState] = useState<CatalogDomainState | null>(null);
  const [action, setAction] = useState<CatalogAuthorizedAction | null>(null);
  const [actionRegistrationId, setActionRegistrationId] = useState<string | null>(null);
  const [surfaceEpoch, setSurfaceEpoch] = useState(0);
  const [publicationSurface, setPublicationSurface] = useState<PublicationSurfaceItem | null>(null);
  const [publicationHistory, setPublicationHistory] = useState<CatalogPublicationJobResponse["item"][]>([]);
  const catalogReleaseId = domainState?.catalogReleaseId ?? anchor.catalogReleaseId ?? "";
  const subjectId = anchor.subjectId ?? "";

  const handleAction = useCallback(
    (next: CatalogAuthorizedAction, context?: { subjectId?: string | null; registrationId?: string | null }) => {
      if (
        next === "register-subject" ||
        next === "update-placement" ||
        next === "preview-publication" ||
        next === "publish-publication"
      ) {
        setAction(next);
        setActionRegistrationId(context?.registrationId ?? null);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [surface, history] = await Promise.all([
          catalog.getPublicationSurface(),
          catalog.listPublications({ limit: 20 })
        ]);
        if (cancelled) return;
        setPublicationSurface(surface.item);
        setPublicationHistory([...history.items]);
      } catch {
        if (!cancelled) {
          setPublicationSurface(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog, surfaceEpoch]);

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

  const surfaceStatus = publicationSurface ? publicationSurfaceMessage(publicationSurface) : null;

  return (
    <div className="parameter-catalog-organization">
      {surfaceStatus ? (
        <section
          className="parameter-catalog__banner"
          data-tone={surfaceStatus.tone}
          aria-label={publicationSurfaceCopy.title}
        >
          <p>{surfaceStatus.message}</p>
          <p>{publicationSurfaceCopy.nextStep}：{surfaceStatus.next}</p>
        </section>
      ) : null}
      <CatalogPage
        key={surfaceEpoch}
        repository={catalog}
        actor={actor}
        sessionPermissions={sessionPermissions}
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
            onRefreshEvidence={() => setSurfaceEpoch((value) => value + 1)}
          />
          <ProposalPanel
            actor={actor}
            domainState={domainState}
            repository={governance}
            catalogReleaseId={catalogReleaseId}
            currentPersonId={currentPersonId}
            definitionId={anchor.definitionId ?? undefined}
            createIdempotencyKey={createGovernanceIdempotencyKey}
            onRefreshEvidence={async () => {
              const current = await catalog.getCatalog();
              if (current.item === null) return;
              onAnchorChange(buildCatalogHref({ ...anchor, catalogReleaseId: current.item.catalogReleaseId }), "replace");
              setSurfaceEpoch((value) => value + 1);
            }}
          />
          <section className="parameter-catalog__history" aria-label={publicationSurfaceCopy.history}>
            <h2>{publicationSurfaceCopy.history}</h2>
            {publicationHistory.length === 0 ? (
              <p>{publicationSurfaceCopy.historyEmpty}</p>
            ) : (
              <ul>
                {publicationHistory.map((job) => (
                  <li key={job.id}>
                    <code>{job.id}</code>
                    <span>{job.status}</span>
                    {job.currentness ? <span>{job.currentness}</span> : null}
                    {job.effective ? <span>receipt</span> : null}
                    {job.sourceKind ? <span>{job.sourceKind}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
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
          registrationId={actionRegistrationId ?? undefined}
          createIdempotencyKey={createGovernanceIdempotencyKey}
          onCompleted={() => setSurfaceEpoch((value) => value + 1)}
          onRefreshEvidence={() => setSurfaceEpoch((value) => value + 1)}
          onOpenChange={(open) => {
            if (!open) {
              setAction(null);
              setActionRegistrationId(null);
            }
          }}
        />
      ) : null}
      {catalogReleaseId &&
      domainState &&
      organizationId &&
      (action === "preview-publication" || action === "publish-publication") ? (
        <PublicationDialog
          open
          actor={actor}
          sessionPermissions={sessionPermissions}
          domainState={domainState}
          catalog={catalog}
          governance={governance}
          catalogReleaseId={catalogReleaseId}
          currentPersonId={currentPersonId}
          organizationId={organizationId}
          publicationSurface={publicationSurface}
          createIdempotencyKey={createGovernanceIdempotencyKey}
          onCompleted={() => setSurfaceEpoch((value) => value + 1)}
          onRefreshEvidence={() => setSurfaceEpoch((value) => value + 1)}
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
