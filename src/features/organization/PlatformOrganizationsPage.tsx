import { useEffect, useState, type FormEvent } from "react";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { SearchField } from "@/components/common/SearchField";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import type { WiseEffAuthClient } from "@/app/appRuntime";
import type { LocalAuthPublicConfigDto } from "@/infrastructure/http/authClient";
import type { PlatformOrganization, PlatformOrganizationsClient } from "@/infrastructure/http/platformOrganizationsClient";
import { presentError } from "@/infrastructure/http/presentError";
import "./platform-organizations.css";
import { OrganizationAdministratorControls } from "./OrganizationAdministratorControls";

export function PlatformOrganizationsPage({ client, authClient, onNavigate }: { client: PlatformOrganizationsClient; authClient: WiseEffAuthClient; onNavigate: (path: string) => void }) {
  const [items, setItems] = useState<PlatformOrganization[]>([]), [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const [authentication, setAuthentication] = useState<LocalAuthPublicConfigDto | null>(null);
  const [creating, setCreating] = useState(false), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState("");
  const [selected, setSelected] = useState<PlatformOrganization | null>(null), [notice, setNotice] = useState("");
  const [administratorPending, setAdministratorPending] = useState(false);
  const [name, setName] = useState(""), [administratorName, setAdministratorName] = useState(""), [username, setUsername] = useState(""), [password, setPassword] = useState(""), [subject, setSubject] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      void Promise.all([client.list(query), authClient.getLocalAuthConfig?.()]).then(([rows, config]) => {
        if (cancelled) return;
        if (!config) throw new Error("Authentication configuration unavailable");
        setItems(rows); setAuthentication(config);
      }).catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "无法加载组织目录，请重试。")); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [client, authClient, query, attempt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !authentication) return;
    setSaving(true); setSaveError("");
    try {
      const item = await client.create({ name: name.trim(), initialAdministrator: authentication.provider === "oidc"
        ? { authentication: "oidc", name: administratorName.trim(), issuer: authentication.oidcIssuer ?? "", subject }
        : { name: administratorName.trim(), username: username.trim(), password } });
      setPassword(""); setCreating(false); setSelected(item); setQuery(""); setAttempt((value) => value + 1);
      setNotice("组织及初始管理员已创建。");
    } catch (failure: unknown) { setSaveError(presentError(failure, "组织创建失败，请检查初始管理员的登录信息后重试。")); }
    finally { setSaving(false); }
  }

  return <>
    <AdminListPage label="组织目录" headerContent={<span>共 {items.length} 个组织</span>}
      headerActions={<><Button variant="ghost" onClick={() => onNavigate("/organization")}>所属组织</Button><Button disabled={loading || Boolean(error) || !authentication} onClick={() => {
        setName(""); setAdministratorName(""); setUsername(""); setPassword(""); setSubject(""); setSaveError(""); setCreating(true);
      }}>创建组织</Button></>}
      filterBar={<SearchField value={query} onValueChange={setQuery} ariaLabel="搜索组织" placeholder="搜索组织名称或编号" loading={loading} maxLength={200} />}
      notice={notice ? <p role="status">{notice}</p> : undefined}
      tableState={loading ? <SectionSkeleton label="正在加载组织目录" /> : error ? <SectionError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : undefined}
      table={{ rows: items, rowKey: (row) => row.id, ariaLabel: "平台组织目录", columns: [
        { key: "name", header: "组织", render: (row) => <div><strong>{row.name}</strong><div className="platform-organizations__id">{row.id}</div></div> },
        { key: "status", header: "状态", render: () => <Badge variant="secondary">正常</Badge> },
        { key: "administrators", header: "管理员", render: (row) => row.administrators.map((admin) => `${admin.name}${!admin.isActive ? "（已停用）" : !admin.canLogin ? "（未配置登录身份）" : ""}`).join("、") || "暂无管理员" },
        { key: "createdAt", header: "创建时间", render: (row) => formatAbsolute(row.createdAt) }
      ] }} rowActions={(row) => ({ label: `${row.name}操作`, items: [], primaryAction: { id: "view", label: "查看", onSelect: () => { setSelected(row); setNotice(""); } } })}
      emptyState={{ title: query ? "未找到匹配的组织" : "暂无组织", message: query ? "调整名称或编号后重试。" : "创建组织并指定初始管理员。" }} />
    <ModalDialog open={creating} onDismiss={saving ? undefined : () => { setCreating(false); setPassword(""); }} className="platform-organizations__dialog modal-card--sm">
      {({ titleId }) => <form className="modal-form-contents" onSubmit={(event) => void submit(event)} aria-busy={saving}>
        <h3 id={titleId}>创建组织</h3>
        <fieldset className="platform-organizations__fields" disabled={saving}>
          <label>组织名称<Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} required /></label>
          <label>初始管理员姓名<Input value={administratorName} onChange={(event) => setAdministratorName(event.target.value)} required /></label>
          {authentication?.provider === "oidc" ? <>
            <label>身份提供方<Input value={authentication.oidcIssuer ?? ""} readOnly /></label>
            <label>外部身份标识（Subject）<Input value={subject} maxLength={255} onChange={(event) => setSubject(event.target.value)} required /></label>
            <p>创建后，请在身份系统为此账号设置新组织编号，再登录管理。</p>
          </> : <>
            <label>管理员用户名<Input value={username} minLength={3} maxLength={64} pattern={"[a-zA-Z0-9._\\-]+"} autoComplete="off" onChange={(event) => setUsername(event.target.value)} required /></label>
            <label>管理员初始密码<Input type="password" value={password} minLength={8} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} required /></label>
            <p>密码至少 8 个字符，创建后通过可信渠道交给初始管理员。</p>
          </>}
        </fieldset>
        {saveError ? <p role="alert">{saveError}</p> : null}
        <div className="platform-organizations__actions"><Button type="button" variant="ghost" disabled={saving} onClick={() => { setCreating(false); setPassword(""); }}>取消</Button><Button type="submit" disabled={saving}>{saving ? "正在创建…" : "创建组织及管理员"}</Button></div>
      </form>}
    </ModalDialog>
    <ModalDialog open={Boolean(selected)} onDismiss={administratorPending ? undefined : () => setSelected(null)} className="platform-organizations__dialog modal-card--sm">
      {({ titleId }) => <><h3 id={titleId}>组织资料</h3>{selected ? <dl className="platform-organizations__details">
        <dt>名称</dt><dd>{selected.name}</dd><dt>组织编号</dt><dd>{selected.id}</dd><dt>状态</dt><dd>正常</dd>
        <dt>创建时间</dt><dd>{formatAbsolute(selected.createdAt)}</dd><dt>管理员</dt><dd>{selected.administrators.map((admin) => `${admin.name}${!admin.isActive ? "（已停用）" : !admin.canLogin ? "（未配置登录身份）" : ""}`).join("、") || "暂无管理员"}</dd>
      </dl> : null}{selected ? <OrganizationAdministratorControls key={selected.id} organization={selected} authentication={authentication} client={client} onPendingChange={setAdministratorPending}
        onUpdated={(item) => { setSelected(item); setAttempt((value) => value + 1); setNotice("组织管理员已调整。"); }} /> : null}
      <div className="platform-organizations__actions"><Button variant="outline" disabled={administratorPending} onClick={() => setSelected(null)}>关闭</Button>
        {selected ? <Button disabled={administratorPending} onClick={() => onNavigate(`/organization?organizationId=${encodeURIComponent(selected.id)}`)}>进入组织</Button> : null}</div></>}
    </ModalDialog>
  </>;
}
