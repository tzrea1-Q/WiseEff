import { useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { LogDomain } from "@/domain/logs/types";
import type { LogDomainUpdateInput } from "@/application/ports/LogAnalysisRepository";
import "./skill-workspace.css";

export function SkillIdentityDialog({ skill, restore, onSave, onSaved, onDismiss, onNavigate }: {
  skill: LogDomain; restore: boolean; onSave: (input: LogDomainUpdateInput) => Promise<LogDomain | null>;
  onSaved: (skill: LogDomain) => void; onDismiss: () => void; onNavigate: (path: string) => void;
}) {
  const [name, setName] = useState(skill.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; conflict?: { id: string; name: string } }>();
  const nameRef = useRef<HTMLInputElement>(null);
  return <ModalDialog open describedBy onDismiss={pending ? undefined : onDismiss} initialFocusRef={nameRef} className="skill-authoring-dialog modal-card--md">
    {({ titleId, descriptionId }) => <form noValidate onSubmit={(event) => {
      event.preventDefault();
      if (pending) return;
      if (!name.trim()) { setError({ message: "请输入名称。" }); nameRef.current?.focus(); return; }
      setPending(true); setError(undefined);
      void onSave({ domainId: skill.id, name: name.trim(), ...(restore ? { status: "active" as const } : {}) })
        .then(updated => { if (!updated) throw new Error("unavailable"); onSaved(updated); })
        .catch((cause: unknown) => {
          const conflict = cause instanceof WiseEffApiError ? cause.details.conflictingSkill as { id?: unknown; name?: unknown } | undefined : undefined;
          setError({ message: cause instanceof WiseEffApiError ? cause.message : `${restore ? "恢复" : "修改"}失败，请重试。`,
            ...(typeof conflict?.id === "string" && typeof conflict.name === "string" ? { conflict: { id: conflict.id, name: conflict.name } } : {}) });
        }).finally(() => setPending(false));
    }}>
      <h2 id={titleId}>{restore ? "恢复技能" : "修改技能名称"}</h2>
      <p id={descriptionId}>{restore ? "恢复同一技能及其版本、历史和链接；仅已发布版本可用于分析，已吊销的集成凭据不会重新启用。" : "修改名称会保留技能标识、版本、历史分析和既有链接。"}</p>
      <div className="grid gap-2"><Label htmlFor="skill-identity-name">名称</Label>
        <Input id="skill-identity-name" ref={nameRef} required maxLength={120} value={name} disabled={pending}
          aria-invalid={!!error} aria-describedby={error ? "skill-identity-error" : undefined} onChange={event => setName(event.target.value)} /></div>
      {error ? <div id="skill-identity-error" role="alert"><p>{error.message}</p>{error.conflict ? <Button asChild variant="link">
        <a href={`/log-admin/skills/${encodeURIComponent(error.conflict.id)}`} onClick={event => {
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onNavigate(event.currentTarget.getAttribute("href")!); }
        }}>查看占用技能「{error.conflict.name}」</a></Button> : null}</div> : null}
      <div className="dialog-actions"><Button type="button" variant="outline" disabled={pending} onClick={onDismiss}>取消</Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "保存中…" : restore ? "恢复技能" : "保存名称"}</Button></div>
    </form>}
  </ModalDialog>;
}
