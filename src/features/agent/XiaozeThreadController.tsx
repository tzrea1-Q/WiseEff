import { useEffect, useRef } from "react";
import type { Message } from "@ag-ui/core";
import { UseAgentUpdate, useAgent } from "@copilotkit/react-core/v2";
import { getXiaozeThread } from "@/infrastructure/http/xiaozeThreadsClient";
import { wiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { clearXiaozePromptDebugStore } from "./XiaozePromptDebugContext";
import { readActiveXiaozeThreadStoreSnapshot, useXiaozeThreads } from "./XiaozeThreadContext";
import { isKnownPersistedThread } from "./xiaozeThreadStorage";

const isApiRuntime = wiseEffRuntimeMode === "api";

function mapThreadMessages(messages: Awaited<ReturnType<typeof getXiaozeThread>>["messages"]): Message[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "reasoning")
    .map(
      (message) =>
        ({
          id: message.id,
          role: message.role,
          content: message.content,
          ...(message.metadata ? { metadata: message.metadata } : {})
        }) as Message
    );
}

export function XiaozeThreadController() {
  const { agent } = useAgent({
    agentId: "default",
    updates: [UseAgentUpdate.OnMessagesChanged]
  });
  const { activeThreadId, persistActiveThread, threads, threadsHydrated } = useXiaozeThreads();
  const persistActiveThreadRef = useRef(persistActiveThread);
  const loadedThreadRef = useRef<string | null>(null);
  const skipNextPersistRef = useRef(false);

  persistActiveThreadRef.current = persistActiveThread;

  useEffect(() => {
    if (loadedThreadRef.current === activeThreadId) {
      return;
    }
    if (isApiRuntime && !threadsHydrated) {
      return;
    }

    skipNextPersistRef.current = true;

    if (isApiRuntime) {
      if (!isKnownPersistedThread(threads, activeThreadId)) {
        agent.setMessages([]);
        loadedThreadRef.current = activeThreadId;
        clearXiaozePromptDebugStore();
        return;
      }

      let cancelled = false;

      getXiaozeThread(activeThreadId)
        .then((thread) => {
          if (cancelled) {
            return;
          }
          agent.setMessages(mapThreadMessages(thread.messages));
          loadedThreadRef.current = activeThreadId;
          clearXiaozePromptDebugStore();
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          agent.setMessages([]);
          loadedThreadRef.current = activeThreadId;
          clearXiaozePromptDebugStore();
        });
      return () => {
        cancelled = true;
      };
    }

    const savedMessages =
      readActiveXiaozeThreadStoreSnapshot().threads.find((thread) => thread.id === activeThreadId)?.messages ?? [];
    agent.setMessages(savedMessages as Message[]);
    loadedThreadRef.current = activeThreadId;
    clearXiaozePromptDebugStore();
  }, [activeThreadId, agent, threads, threadsHydrated]);

  useEffect(() => {
    if (loadedThreadRef.current !== activeThreadId) {
      return;
    }
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    persistActiveThreadRef.current(agent.messages);
  }, [activeThreadId, agent.messages]);

  return null;
}
