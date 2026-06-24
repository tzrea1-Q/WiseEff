import { useEffect, useRef } from "react";
import type { Message } from "@ag-ui/core";
import { UseAgentUpdate, useAgent } from "@copilotkit/react-core/v2";
import { getXiaozeThread } from "@/infrastructure/http/xiaozeThreadsClient";
import { wiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { clearXiaozePromptDebugStore } from "./XiaozePromptDebugContext";
import { readActiveXiaozeThreadStoreSnapshot, useXiaozeThreads } from "./XiaozeThreadContext";

const isApiRuntime = wiseEffRuntimeMode === "api";

export function XiaozeThreadController() {
  const { agent } = useAgent({
    agentId: "default",
    updates: [UseAgentUpdate.OnMessagesChanged]
  });
  const { activeThreadId, persistActiveThread } = useXiaozeThreads();
  const persistActiveThreadRef = useRef(persistActiveThread);
  const loadedThreadRef = useRef<string | null>(null);
  const skipNextPersistRef = useRef(false);

  persistActiveThreadRef.current = persistActiveThread;

  useEffect(() => {
    if (loadedThreadRef.current === activeThreadId) {
      return;
    }
    skipNextPersistRef.current = true;

    if (isApiRuntime) {
      let cancelled = false;
      const knownThread = readActiveXiaozeThreadStoreSnapshot().threads.some((thread) => thread.id === activeThreadId);
      if (!knownThread) {
        agent.setMessages([]);
        loadedThreadRef.current = activeThreadId;
        clearXiaozePromptDebugStore();
        return;
      }

      getXiaozeThread(activeThreadId)
        .then((thread) => {
          if (cancelled) {
            return;
          }
          agent.setMessages(
            thread.messages
              .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "reasoning")
              .map(
                (message) =>
                  ({
                    id: message.id,
                    role: message.role,
                    content: message.content
                  }) as Message
              )
          );
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
  }, [activeThreadId, agent]);

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
