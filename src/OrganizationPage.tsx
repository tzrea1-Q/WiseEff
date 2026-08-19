import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { OrganizationAdminArea } from "@/application/organization/organizationAdminPath";
import { OrganizationAdminScopeNav } from "@/components/admin/OrganizationAdminScopeNav";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { presentError } from "@/infrastructure/http/presentError";
import { UserPermissionsPage, type UserPermissionsPageProps } from "@/UserPermissionsPage";

export type OrganizationRecord = {
  id: string;
  name: string;
  createdAt: string;
};

export type OrganizationActions = {
  getOrganization(): Promise<OrganizationRecord>;
  updateOrganization(input: { name: string }): Promise<OrganizationRecord>;
};

type OrganizationPageProps = UserPermissionsPageProps & {
  area?: OrganizationAdminArea;
  organizationActions?: OrganizationActions;
  onOrganizationUpdated?: (organization: OrganizationRecord) => void | Promise<void>;
};

export function OrganizationPage({
  area = "profile",
  organizationActions,
  onOrganizationUpdated,
  ...memberProps
}: OrganizationPageProps) {
  const [organization, setOrganization] = useState<OrganizationRecord | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

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

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationActions || !organization) {
      return;
    }
    const name = displayName.trim();
    if (!name) {
      setSaveError("显示名称不能为空。");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const next = await organizationActions.updateOrganization({ name });
      setOrganization(next);
      setDisplayName(next.name);
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

  const nameUnchanged = displayName.trim() === (organization?.name ?? "");

  return (
    <div className="organization-page">
      <OrganizationAdminScopeNav active={area} onNavigate={memberProps.onNavigate} />
      {area === "members" ? (
        <UserPermissionsPage {...memberProps} />
      ) : (
        <section className="organization-profile" aria-label="组织档案">
          <div className="organization-profile__heading">
            <span className="eyebrow">组织档案</span>
            <h2>本组织</h2>
          </div>
          {status === "loading" ? <SectionSkeleton label="正在加载组织档案" /> : null}
          {status === "error" ? <SectionError message={error} onRetry={() => void loadOrganization()} /> : null}
          {status === "ready" && organizationActions && organization ? (
            <form className="organization-profile__form" onSubmit={submitRename}>
              <label className="organization-profile__field" htmlFor="organization-display-name">
                <span className="organization-profile__label">显示名称</span>
                <input
                  id="organization-display-name"
                  className="organization-profile__control"
                  value={displayName}
                  maxLength={80}
                  aria-invalid={saveError ? true : undefined}
                  aria-describedby={saveError ? "organization-display-name-error" : undefined}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    setSaveError("");
                  }}
                  required
                />
              </label>
              <div className="organization-profile__meta">
                <div>
                  <span className="organization-profile__label">组织编号</span>
                  <code className="organization-profile__id">{organization.id}</code>
                </div>
                <div>
                  <span className="organization-profile__label">创建时间</span>
                  <time
                    className="organization-profile__created-at"
                    dateTime={organization.createdAt}
                    title={formatAbsolute(organization.createdAt)}
                  >
                    {formatAbsolute(organization.createdAt)}
                  </time>
                </div>
              </div>
              {saveError ? (
                <p id="organization-display-name-error" role="alert" className="organization-profile__error">
                  {saveError}
                </p>
              ) : null}
              <button className="button primary organization-profile__save" type="submit" disabled={saving || nameUnchanged}>
                {saving ? "保存中" : "保存名称"}
              </button>
            </form>
          ) : null}
        </section>
      )}
    </div>
  );
}
