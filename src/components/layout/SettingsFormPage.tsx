import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import type { SettingsLeaveRequest } from "@/application/settingsFormNavigation";
import "./settings-form-page.css";

export function useDirtyState<Value>(draft: Value, saved: Value) {
  return JSON.stringify(draft) !== JSON.stringify(saved);
}

type SettingsFormPageProps = {
  label: string;
  dirty: boolean;
  saving?: boolean;
  error?: string;
  onSave: () => void;
  onDiscard: () => void;
  children: ReactNode;
};

export function SettingsFormPage({ label, dirty, saving = false, error, onSave, onDiscard, children }: SettingsFormPageProps) {
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveDecision = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(null);
  const finishLeave = (allowed: boolean) => {
    leaveDecision.current?.resolve(allowed);
    leaveDecision.current = null;
    setLeaveOpen(false);
  };
  useEffect(() => {
    if (!dirty) return;
    const guardLeave = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (saving) return;
      if (!leaveDecision.current) {
        let resolve!: (allowed: boolean) => void;
        const promise = new Promise<boolean>((complete) => { resolve = complete; });
        leaveDecision.current = { promise, resolve };
      }
      (event as CustomEvent<SettingsLeaveRequest>).detail.decision = leaveDecision.current.promise;
      setLeaveOpen(true);
    };
    const guardUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("wiseeff:settings-before-leave", guardLeave);
    window.addEventListener("beforeunload", guardUnload);
    return () => {
      window.removeEventListener("wiseeff:settings-before-leave", guardLeave);
      window.removeEventListener("beforeunload", guardUnload);
      leaveDecision.current?.resolve(false);
      leaveDecision.current = null;
    };
  }, [dirty, saving]);
  return <><form className="settings-form-page" aria-label={label} aria-busy={saving} data-settings-dirty={dirty} noValidate
    onSubmit={(event) => { event.preventDefault(); if (dirty && !saving) onSave(); }}>
    {error ? <div className="settings-form-page__error" role="alert" aria-label="保存错误摘要"><strong>保存失败</strong><p>{error}</p></div> : null}
    {children}
    {dirty ? <div className="settings-form-page__save-bar" role="group" aria-label="未保存的更改">
      <span>有未保存的更改</span>
      <Button type="button" variant="outline" disabled={saving} onClick={onDiscard}>放弃</Button>
      <Button type="submit" disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
    </div> : null}
  </form><ConfirmDialog open={leaveOpen && dirty && !saving} title="放弃未保存的更改？"
    description="离开将放弃本页未保存的更改。已保存的设置不会受到影响。"
    confirmLabel="放弃并离开" cancelLabel="继续编辑" tone="danger"
    onConfirm={() => finishLeave(true)} onCancel={() => finishLeave(false)} /></>;
}

export function SettingsFormSection({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return <section className="settings-form-page__section" aria-label={title}>
    <header><h2>{title}</h2><p>{help}</p></header>{children}
  </section>;
}
