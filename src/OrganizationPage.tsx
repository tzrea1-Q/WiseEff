import { useCallback, useEffect, useRef, useState } from "react";

import type { OrganizationAdminArea } from "@/application/organization/organizationAdminPath";
import { OrganizationAdminScopeNav } from "@/components/admin/OrganizationAdminScopeNav";
import { OrganizationBridgePanel } from "@/components/admin/OrganizationBridgePanel";
import { canPerform } from "@/app/permissions";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { SettingsFormPage, SettingsFormSection, useDirtyState } from "@/components/layout/SettingsFormPage";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { presentError } from "@/infrastructure/http/presentError";
import { UserPermissionsPage, type UserPermissionsPageProps } from "@/UserPermissionsPage";
import "./organization-page.css";

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
  apiMode?: boolean;
  organizationActions?: OrganizationActions;
  onOrganizationUpdated?: (organization: OrganizationRecord) => void | Promise<void>;
};

export function OrganizationPage({
  area = "profile",
  apiMode = false,
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
  const [fieldError, setFieldError] = useState("");
  const [saved, setSaved] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);

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
    if (!organizationActions || !organization || saving) {
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
      <OrganizationAdminScopeNav active={area} onNavigate={memberProps.onNavigate} />
      {area === "bridges" ? <OrganizationBridgePanel enabled={apiMode && canPerform(memberProps.state.activeRoleId, "users.manage")} /> : area === "members" ? (
        <UserPermissionsPage {...memberProps} />
      ) : (
        <section className="organization-profile" aria-label="组织档案">
          {status === "loading" ? <SectionSkeleton label="正在加载组织档案" /> : null}
          {status === "error" ? <SectionError message={error} onRetry={() => void loadOrganization()} /> : null}
          {status === "ready" && organizationActions && organization ? (
            <SettingsFormPage label="组织设置" dirty={dirty} saving={saving} error={saveError}
              onSave={() => void submitRename()} onDiscard={() => {
                setDisplayName(organization.name); setSaveError(""); setFieldError(""); setSaved(false);
              }}>
              <SettingsFormSection title="基本信息" help="组织名称用于工作台展示，便于成员识别所属组织。">
                <div className="organization-profile__field">
                  <label className="organization-profile__label" htmlFor="organization-display-name">显示名称</label>
                  <input
                    ref={nameInput}
                    id="organization-display-name"
                    className="organization-profile__control"
                    value={displayName}
                    maxLength={80}
                    disabled={saving}
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
