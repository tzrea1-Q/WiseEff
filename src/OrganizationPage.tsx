import { useCallback, useEffect, useRef, useState } from "react";

import type { OrganizationAdminArea } from "@/application/organization/organizationAdminPath";
import { OrganizationAdminScopeNav } from "@/components/admin/OrganizationAdminScopeNav";
import { OrganizationBridgePanel } from "@/components/admin/OrganizationBridgePanel";
import { canPerform } from "@/app/permissions";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { SettingsFormPage, SettingsFormSection, useDirtyState } from "@/components/layout/SettingsFormPage";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { presentError } from "@/infrastructure/http/presentError";
import { UserPermissionsPage, type UserPermissionsPageProps } from "@/UserPermissionsPage";
import { IntegrationCredentials } from "@/features/log-skills/IntegrationCredentials";
import { OrganizationProjectsPanel, type ProjectMembershipClient } from "@/features/organization/OrganizationProjectsPanel";
import { OrganizationTeamsPage } from "@/features/organization/OrganizationTeamsPage";
import { OrganizationAssetHandoverPanel } from "@/features/organization/OrganizationAssetHandoverPanel";
import { withOrganizationScope } from "@/infrastructure/http/organizationScope";
import { OrganizationInvitationsPage } from "@/features/organization/OrganizationInvitationsPage";
import type { OrganizationInvitationsClient } from "@/infrastructure/http/organizationInvitationsClient";
import type { ComponentProps } from "react";
import { OrganizationOverviewPanel, OrganizationResourcesPanel } from "@/features/organization/OrganizationOverviewPanel";
import type { OrganizationWorkspaceSummary } from "@/infrastructure/http/userGovernanceClient";
import { VISIBLE_WORKFLOWS, type WorkflowId } from "@/domain/workflowDiscovery";
import { ViewSwitch } from "@/components/ui/view-switch";
import type { WorkflowPublicationView } from "@/application/workflow-publication/useWorkflowPublication";
import "./organization-page.css";

export type OrganizationRecord = {
  id: string;
  name: string;
  createdAt: string;
};

export type OrganizationActions = {
  getWorkspaceSummary?(): Promise<OrganizationWorkspaceSummary>;
  getOrganization(): Promise<OrganizationRecord>;
  updateOrganization(input: { name: string }): Promise<OrganizationRecord>;
};

export type OrganizationPageProps = UserPermissionsPageProps & {
  area?: OrganizationAdminArea;
  apiMode?: boolean;
  readOnly?: boolean;
  organizationActions?: OrganizationActions;
  onOrganizationUpdated?: (organization: OrganizationRecord) => void | Promise<void>;
  bridgeActions?: ComponentProps<typeof OrganizationBridgePanel>["actions"];
  credentialRepository?: ComponentProps<typeof IntegrationCredentials>["repository"];
  invitationActions?: OrganizationInvitationsClient;
  projectMembershipClient?: ProjectMembershipClient;
  visibleWorkflows?: readonly WorkflowId[];
  publication?: WorkflowPublicationView;
};

export function OrganizationPage({
  area = "overview",
  apiMode = false,
  readOnly = false,
  organizationActions,
  onOrganizationUpdated,
  bridgeActions,
  credentialRepository,
  invitationActions,
  projectMembershipClient,
  visibleWorkflows = VISIBLE_WORKFLOWS,
  publication,
  ...memberProps
}: OrganizationPageProps) {
  const [organization, setOrganization] = useState<OrganizationRecord | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [saved, setSaved] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const administrator = canPerform(memberProps.state.activeRoleId, "users.manage");

  const loadOrganization = useCallback(async () => {
    if (!organizationActions) {
      setStatus("ready");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const next = await organizationActions.getOrganization();
      setOrganization(next);
      setDisplayName(next.name);
      setStatus("ready");
    } catch (loadError) {
      setError(presentError(loadError, "无法加载组织档案。"));
      setStatus("error");
    }
  }, [organizationActions]);

  useEffect(() => {
    if (area !== "profile") {
      return;
    }
    void loadOrganization();
  }, [area, loadOrganization]);

  async function submitRename() {
    if (!organizationActions || !organization || saving || readOnly || !administrator) {
      return;
    }
    const name = displayName.trim();
    if (!name) {
      setFieldError("显示名称不能为空。");
      setSaveError("");
      nameInput.current?.focus();
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const next = await organizationActions.updateOrganization({ name });
      setOrganization(next);
      setDisplayName(next.name);
      setSaved(true);
      try {
        await onOrganizationUpdated?.(next);
      } catch {
        // Home-org name is already saved; refreshing /me is best-effort.
      }
    } catch (updateError) {
      setSaveError(presentError(updateError, "组织名称保存失败，请稍后重试。"));
    } finally {
      setSaving(false);
    }
  }

  const dirty = useDirtyState(displayName, organization?.name ?? "");

  return (
    <div className="organization-page">
      <OrganizationAdminScopeNav active={area} administrator={administrator} organizationId={memberProps.directoryScope} onNavigate={memberProps.onNavigate} />
      {administrator && (area === "bridges" || area === "integrations") ? <ViewSwitch variant="section" ariaLabel="组织资源控制台" value={area}
        onValueChange={(value) => memberProps.onNavigate(withOrganizationScope(`/organization/${value}`, memberProps.directoryScope))}
        items={[{ value: "resources", label: "全部资源" }, { value: "bridges", label: "设备代理" }, { value: "integrations", label: "集成凭据" }]} /> : null}
      {area === "overview" ? <OrganizationOverviewPanel load={organizationActions?.getWorkspaceSummary} visibleWorkflows={visibleWorkflows} organizationId={memberProps.directoryScope} onNavigate={memberProps.onNavigate} />
        : area === "resources" ? <OrganizationResourcesPanel administrator={administrator} roleId={memberProps.state.activeRoleId} visibleWorkflows={visibleWorkflows} publication={publication} organizationId={memberProps.directoryScope} onNavigate={memberProps.onNavigate} />
        : !administrator && area !== "profile" ? <SectionEmpty message="此区域由组织管理员维护。" actionLabel="查看组织资源" onAction={() => memberProps.onNavigate(withOrganizationScope("/organization/resources", memberProps.directoryScope))} />
        : area === "handovers" ? <OrganizationAssetHandoverPanel organizationId={memberProps.directoryScope} enabled={apiMode} currentUserId={memberProps.state.currentUserId} onNavigate={memberProps.onNavigate} />
        : area === "invitations" ? <OrganizationInvitationsPage client={invitationActions} readOnly={readOnly} search={memberProps.search} canGrantPlatformAdmin={memberProps.state.activeRoleId === "platform-admin"}
          onViewMember={(id) => memberProps.onNavigate(withOrganizationScope(`/organization/members?memberId=${encodeURIComponent(id)}`, memberProps.directoryScope))}
          onBack={() => memberProps.onNavigate(withOrganizationScope("/organization/members", memberProps.directoryScope))} />
        : area === "teams" ? <OrganizationTeamsPage client={memberProps.teamActions} readOnly={readOnly} search={memberProps.search} />
        : area === "bridges" ? <OrganizationBridgePanel enabled={apiMode && administrator} readOnly={readOnly} onNavigate={memberProps.onNavigate} actions={bridgeActions} />
        : area === "integrations" ? <div className="skill-section"><IntegrationCredentials repository={credentialRepository} apiMode={apiMode} canView={administrator && canPerform(memberProps.state.activeRoleId, "logs.admin-domains")} canEdit={!readOnly && canPerform(memberProps.state.activeRoleId, "logs.admin-domains")} disabled={false} /></div>
        : area === "projects" ? <OrganizationProjectsPanel client={projectMembershipClient} readOnly={readOnly} search={memberProps.search} onNavigate={memberProps.onNavigate} organizationId={memberProps.directoryScope} />
        : area === "members" ? <UserPermissionsPage {...memberProps} readOnly={readOnly} onInvite={invitationActions ? () => memberProps.onNavigate(withOrganizationScope("/organization/invitations?create=1", memberProps.directoryScope)) : undefined} /> : (
        <section className="organization-profile" aria-label="组织档案">
          {!administrator ? <p>显示名称由组织管理员维护。</p> : null}
          {status === "loading" ? <SectionSkeleton label="正在加载组织档案" /> : null}
          {status === "error" ? <SectionError message={error} onRetry={() => void loadOrganization()} /> : null}
          {status === "ready" && organizationActions && organization ? (
            <SettingsFormPage label="组织资料" saveLabel="保存组织名称" dirty={dirty} saving={saving} error={saveError}
              onSave={() => void submitRename()} onDiscard={() => {
                setDisplayName(organization.name); setSaveError(""); setFieldError(""); setSaved(false);
              }}>
              <SettingsFormSection title="基本信息" help="更名会更新成员看到的组织名称，组织编号保持固定。">
                <div className="organization-profile__field">
                  <label className="organization-profile__label" htmlFor="organization-display-name">显示名称</label>
                  <input
                    ref={nameInput}
                    id="organization-display-name"
                    className="organization-profile__control"
                    value={displayName}
                    maxLength={80}
                    disabled={saving || readOnly || !administrator}
                    aria-invalid={fieldError ? true : undefined}
                    aria-describedby={fieldError ? "organization-display-name-error" : undefined}
                    onChange={(event) => {
                      setDisplayName(event.target.value);
                      setSaveError("");
                      setFieldError("");
                      setSaved(false);
                    }}
                    required
                  />
                  {fieldError ? (
                    <p id="organization-display-name-error" className="organization-profile__error" role="alert">
                      {fieldError}
                    </p>
                  ) : null}
                </div>
                <dl className="organization-profile__meta">
                  <div>
                    <dt className="organization-profile__label">组织编号</dt>
                    <dd><code className="organization-profile__id">{organization.id}</code></dd>
                  </div>
                  <div>
                    <dt className="organization-profile__label">创建时间</dt>
                    <dd>
                      <time
                        className="organization-profile__created-at"
                        dateTime={organization.createdAt}
                        title={formatAbsolute(organization.createdAt)}
                      >
                        {formatAbsolute(organization.createdAt)}
                      </time>
                    </dd>
                  </div>
                </dl>
                {saved ? (
                  <p className="organization-profile__success" role="status">组织名称已保存。</p>
                ) : null}
              </SettingsFormSection>
            </SettingsFormPage>
          ) : null}
        </section>
      )}
    </div>
  );
}
