import { useEffect, useState, type FormEvent } from "react";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LocalAuthPublicConfigDto } from "@/infrastructure/http/authClient";
import type { AdministratorRecovery, PlatformOrganization, PlatformOrganizationsClient } from "@/infrastructure/http/platformOrganizationsClient";
import { presentError } from "@/infrastructure/http/presentError";

export function OrganizationAdministratorControls({ organization, authentication, client, onUpdated, onPendingChange }: {
  organization: PlatformOrganization; authentication: LocalAuthPublicConfigDto | null; client: PlatformOrganizationsClient;
  onUpdated: (organization: PlatformOrganization) => void; onPendingChange: (pending: boolean) => void;
}) {
  const [recovery, setRecovery] = useState<AdministratorRecovery | null>(null), [loadError, setLoadError] = useState(""), [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<"" | "existing" | "new" | "disable">("");
  const [userId, setUserId] = useState(""), [reason, setReason] = useState(""), [error, setError] = useState("");
  const [name, setName] = useState(""), [username, setUsername] = useState(""), [password, setPassword] = useState(""), [subject, setSubject] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void client.getAdministratorRecovery(organization.id).then((data) => { if (!cancelled) { setRecovery(data); setLoadError(""); } })
      .catch((failure: unknown) => { if (!cancelled) setLoadError(presentError(failure, "管理员状态加载失败。")); });
    return () => { cancelled = true; };
  }, [client, organization.id, attempt]);

  function choose(next: typeof mode) { setMode(next); setUserId(""); setReason(""); setError(""); setName(""); setUsername(""); setSubject(""); setPassword(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || mode !== "disable" && !authentication) return;
    setPending(true); onPendingChange(true); setError("");
    try {
      const updated = mode === "disable" ? await client.emergencyDisableAdministrator(organization.id, userId, reason.trim())
        : await client.recoverAdministrator(organization.id, mode === "existing" ? { userId } : { administrator: authentication?.provider === "oidc"
          ? { authentication: "oidc", name: name.trim(), issuer: authentication.oidcIssuer ?? "", subject }
          : { name: name.trim(), username: username.trim(), password } });
      setPassword(""); setMode(""); setAttempt((value) => value + 1); onUpdated(updated);
    } catch (failure: unknown) { setError(presentError(failure, "管理员调整失败，请核对后重试。")); }
    finally { setPending(false); onPendingChange(false); }
  }

  if (loadError) return <SectionError message={loadError} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!recovery) return <SectionSkeleton label="正在核对有效管理员" />;
  return <section aria-label="管理员管理" className="platform-organizations__administration">
    <h4>管理员管理</h4>
    <p>{recovery.usableAdministratorIds.length ? `当前有 ${recovery.usableAdministratorIds.length} 位可登录的组织管理员。` : "当前没有可登录的组织管理员，请指定负责人。"}</p>
    {!mode ? <div className="platform-organizations__actions">
      <Button variant="outline" disabled={!authentication || !recovery.members.length} onClick={() => choose("existing")}>增授管理员角色</Button>
      <Button variant="outline" disabled={!authentication} onClick={() => choose("new")}>新建管理员</Button>
      <details className="platform-organizations__emergency"><summary>紧急操作</summary><Button variant="destructive" disabled={!organization.administrators.some((admin) => admin.isActive)} onClick={() => choose("disable")}>紧急停用管理员</Button></details>
    </div> : <form onSubmit={(event) => void submit(event)}>
      <fieldset className="platform-organizations__fields" disabled={pending}>
        {mode === "new" ? <>
          <label>新管理员姓名<Input value={name} onChange={(event) => setName(event.target.value)} required /></label>
          {authentication?.provider === "oidc" ? <>
            <label>身份提供方<Input value={authentication.oidcIssuer ?? ""} readOnly /></label>
            <label>外部身份标识（Subject）<Input value={subject} maxLength={255} onChange={(event) => setSubject(event.target.value)} required /></label>
            <p>请在身份系统将此账号的组织声明设置为 {organization.id}。</p>
          </> : <>
            <label>新管理员用户名<Input value={username} minLength={3} maxLength={64} pattern={"[a-zA-Z0-9._\\-]+"} autoComplete="off" onChange={(event) => setUsername(event.target.value)} required /></label>
            <label>新管理员初始密码<Input type="password" value={password} minLength={8} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} required /></label>
          </>}
        </> : <SelectControl value={userId} onValueChange={setUserId} ariaLabel={mode === "disable" ? "紧急停用的管理员" : "增授管理员角色的成员"} placeholder="选择成员"
          options={(mode === "disable" ? organization.administrators.filter((admin) => admin.isActive) : recovery.members).map((member) => ({ value: member.id, label: `${member.name}${member.isActive ? "" : "（将重新启用）"}` }))} disabled={pending} />}
        {mode === "disable" ? <>
          <label>紧急停用原因<Input value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} required /></label>
          <p>账号将立即停用，即使它是最后一位组织管理员。完成后可在此指定接任者；平台管理入口仍受保护。</p>
        </> : mode === "existing" ? <p>将启用此成员并增加组织管理员角色，保留原有组织角色与项目职责。成员须具备当前登录方式的身份。</p> : null}
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      <div className="platform-organizations__actions"><Button type="button" variant="ghost" disabled={pending} onClick={() => choose("")}>取消调整</Button>
        <Button type="submit" variant={mode === "disable" ? "destructive" : "default"} disabled={pending || (mode !== "new" && !userId)}>{pending ? "正在保存…" : mode === "disable" ? "确认紧急停用" : mode === "existing" ? "确认增授管理员角色" : "创建管理员"}</Button></div>
    </form>}
  </section>;
}
