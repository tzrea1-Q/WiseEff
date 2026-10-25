import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  saveDisabled?: boolean;
  saveLabel?: string;
  error?: string;
  onSave: () => void;
  onDiscard: () => void;
  children: ReactNode;
};

export function SettingsLeaveGuard({ dirty, saving = false }: { dirty: boolean; saving?: boolean }) {
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveDecision = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(null);
  const finishLeave = (allowed: boolean) => {
    leaveDecision.current?.resolve(allowed);
    leaveDecision.current = null;
    setLeaveOpen(false);
  };
  useLayoutEffect(() => {
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
  return <ConfirmDialog open={leaveOpen && dirty && !saving} title="放弃未保存的更改？"
    description="离开将放弃本页未保存的更改。已保存的设置不会受到影响。"
    confirmLabel="放弃并离开" cancelLabel="继续编辑" tone="danger"
    onConfirm={() => finishLeave(true)} onCancel={() => finishLeave(false)} />;
}

export function SettingsFormPage({ label, dirty, saving = false, saveDisabled = false, saveLabel = "保存", error, onSave, onDiscard, children }: SettingsFormPageProps) {
  return <><form className="settings-form-page" aria-label={label} aria-busy={saving} data-settings-dirty={dirty} noValidate
    onSubmit={(event) => { event.preventDefault(); if (dirty && !saving && !saveDisabled) onSave(); }}>
    {error ? <div className="settings-form-page__error" role="alert" aria-label="保存错误摘要"><strong>保存失败</strong><p>{error}</p></div> : null}
    {children}
    {dirty ? <div className="settings-form-page__save-bar" role="group" aria-label="未保存的更改">
      <span>有未保存的更改</span>
      <Button type="button" variant="outline" disabled={saving} onClick={onDiscard}>放弃</Button>
      <Button type="submit" disabled={saving || saveDisabled}>{saving ? "保存中…" : saveLabel}</Button>
    </div> : null}
  </form><SettingsLeaveGuard dirty={dirty} saving={saving} /></>;
}

export function SettingsFormSection({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return <section className="settings-form-page__section" aria-label={title}>
    <header><h2>{title}</h2>{help ? <p>{help}</p> : null}</header>{children}
  </section>;
}
