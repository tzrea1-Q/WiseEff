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

import { CatalogHistoryBody } from "../parameter-catalog/CatalogPage";
import { DefinitionEditorBody } from "./DefinitionEditorBody";
import { DefinitionLifecycleDialog, type DefinitionLifecycleIntent } from "./DefinitionLifecycleDialog";

import { createGovernanceIdempotencyKey } from "./governanceState";
import { PublicationDialog } from "./PublicationDialog";
import {
  publicationSurfaceAllowsAuthoring,
  publicationSurfaceAllowsPublishing,
  publicationSurfaceCopy,
  publicationSurfaceAdvisory,
  type PublicationSurfaceItem
} from "./publicationSurface";
import { catalogPendingWorkLabel } from "../parameter-catalog/copy";
import { RegistrationDialog } from "./RegistrationDialog";
import { ModalDialog } from "@/components/common/ModalDialog";

import { ReviewQueue } from "./ReviewQueue";
import type { CatalogDefinitionResponse } from "@/infrastructure/http/parameterCatalogDtos";

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
  const [pendingWorkOpen, setPendingWorkOpen] = useState(false);
  const [publicationSurface, setPublicationSurface] = useState<PublicationSurfaceItem | null>(null);
  const [publicationSurfaceLoad, setPublicationSurfaceLoad] = useState<"loading" | "ready" | "error">("loading");
  const [lifecycle, setLifecycle] = useState<{
    intent: DefinitionLifecycleIntent;
    definition: CatalogDefinitionResponse["item"];
  } | null>(null);
  const catalogReleaseId = domainState?.catalogReleaseId ?? anchor.catalogReleaseId ?? "";
  const subjectId = anchor.subjectId ?? "";
  const [catalogSubjects, setCatalogSubjects] = useState<
    Awaited<ReturnType<ParameterCatalogRepository["listSubjects"]>>["items"]
  >([]);

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
        const listed = await catalog.listSubjects({ limit: 100 });
        if (!cancelled) {
          setCatalogSubjects([...listed.items]);
        }
      } catch {
        if (!cancelled) {
          setCatalogSubjects([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog, surfaceEpoch]);


  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const surface = await catalog.getPublicationSurface();
        if (cancelled) return;
        setPublicationSurface(surface.item);
        setPublicationSurfaceLoad("ready");
      } catch {
        if (!cancelled) {
          setPublicationSurface(null);
          setPublicationSurfaceLoad("error");
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

  const surfaceStatus = publicationSurface ? publicationSurfaceAdvisory(publicationSurface) : null;

  return (
    <div className="parameter-catalog-organization">
      {publicationSurfaceLoad === "error" ? (
        <section className="parameter-catalog__banner" data-tone="danger" aria-label={publicationSurfaceCopy.title}>
          <p>{publicationSurfaceCopy.fetchFailed}</p>
          <p>{publicationSurfaceCopy.nextStep}：刷新页面后重试。不要把超时当成已生效。</p>
        </section>
      ) : surfaceStatus ? (
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
        onOpenPendingWork={() => setPendingWorkOpen(true)}
        organizationId={organizationId}
        listReviewItems={
          organizationId ? (orgId, query) => governance.listReviewItems(orgId, query) : undefined
        }
        definitionPublishingAllowed={publicationSurfaceAllowsPublishing(publicationSurface)}
        onDefinitionCommand={(command, definition) => {
          // Identity correction now lives inside the definition's own 编辑 dialog
          // (renderDefinitionEditor below); the row only offers that one action.
          if (command === "correct-identity") return;
          setLifecycle({ intent: command, definition });
        }}
        renderDefinitionEditor={
          domainState
            ? (definition, history) => (
          <DefinitionEditorBody
            actor={actor}
            sessionPermissions={sessionPermissions}
            domainState={domainState}
            catalog={catalog}
            catalogReleaseId={catalogReleaseId}
            definition={definition}
            subjects={catalogSubjects}
            createIdempotencyKey={createGovernanceIdempotencyKey}
            onCompleted={() => setSurfaceEpoch((value) => value + 1)}
            onRefreshEvidence={() => setSurfaceEpoch((value) => value + 1)}
            authoringAllowed={publicationSurfaceAllowsAuthoring(publicationSurface)}
            history={
              <CatalogHistoryBody
                timeline={history.timeline}
                revisions={history.revisions}
              />
            }
          />
              )
            : undefined
        }
      />
      {domainState && catalogReleaseId && organizationId ? (
        <ModalDialog
          open={pendingWorkOpen}
          onDismiss={() => setPendingWorkOpen(false)}
          className="confirm-dialog governance-confirm-dialog parameter-catalog__pending-dialog"
          describedBy
        >
          {({ titleId, descriptionId }) => (
            <>
              <h2 id={titleId}>{catalogPendingWorkLabel}</h2>
              <div id={descriptionId} className="confirm-dialog__scroll">
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
              </div>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button subtle"
                  onClick={() => setPendingWorkOpen(false)}
                >
                  关闭
                </button>
              </div>
            </>
          )}
        </ModalDialog>
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
      {lifecycle && catalogReleaseId && domainState ? (
        <DefinitionLifecycleDialog
          open
          intent={lifecycle.intent}
          actor={actor}
          sessionPermissions={sessionPermissions}
          domainState={domainState}
          catalog={catalog}
          catalogReleaseId={catalogReleaseId}
          definition={lifecycle.definition}
          createIdempotencyKey={createGovernanceIdempotencyKey}
          onCompleted={() => setSurfaceEpoch((value) => value + 1)}
          onRefreshEvidence={() => setSurfaceEpoch((value) => value + 1)}
          onOpenChange={(open) => {
            if (!open) {
              setLifecycle(null);
            }
          }}
        />
      ) : null}

    </div>
  );
}
