import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowPublicationState } from "@/domain/workflowPublication";
import type { WorkflowPublicationClient } from "@/infrastructure/http/workflowPublicationClient";

export type WorkflowPublicationView = {
  status: "loading" | "ready" | "error";
  publication: WorkflowPublicationState | null;
  retry: () => void;
};

/** A snapshot belongs to one authenticated page entry, never to an idle polling loop. */
export function useWorkflowPublication(client: WorkflowPublicationClient | undefined, entryKey: string | null, initialPublication?: WorkflowPublicationState): WorkflowPublicationView {
  const [attempt, setAttempt] = useState(0);
  const entry = useRef({ key: entryKey, serial: 0 });
  if (entry.current.key !== entryKey) entry.current = { key: entryKey, serial: entry.current.serial + 1 };
  const serial = entry.current.serial;
  const [snapshot, setSnapshot] = useState<{
    serial: number;
    attempt: number;
    client: WorkflowPublicationClient | undefined;
    status: WorkflowPublicationView["status"];
    publication: WorkflowPublicationState | null;
  } | null>(() => initialPublication ? { serial, attempt, client, status: "ready", publication: initialPublication } : null);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!entryKey) return;
    let cancelled = false;
    void (client ? client.getPublication() : Promise.reject(new Error("发布配置不可用。")))
      .then((publication) => {
        if (!cancelled) setSnapshot({ serial, attempt, client, status: "ready", publication });
      })
      .catch(() => {
        if (!cancelled) setSnapshot({ serial, attempt, client, status: "error", publication: null });
      });
    return () => { cancelled = true; };
  }, [client, entryKey, serial, attempt]);

  if (!entryKey || snapshot?.serial !== serial || snapshot.attempt !== attempt || snapshot.client !== client) {
    return { status: "loading", publication: null, retry };
  }
  return { status: snapshot.status, publication: snapshot.publication, retry };
}
