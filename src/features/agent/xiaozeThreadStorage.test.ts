import { describe, expect, it } from "vitest";
import {
  areStoredMessagesEqual,
  buildThreadRecord,
  createEmptyThreadSnapshot,
  deriveThreadPreview,
  deriveThreadTitle,
  removeThreadFromSnapshot,
  readXiaozeThreadStore,
  serializeXiaozeMessages,
  upsertThreadRecord,
  writeXiaozeThreadStore
} from "./xiaozeThreadStorage";
import type { XiaozeStoredMessage } from "./xiaozeThreadTypes";

describe("xiaozeThreadStorage", () => {
  it("derives title and preview from stored messages", () => {
    const messages: XiaozeStoredMessage[] = [
      { id: "u1", role: "user", content: "battery_temp_target_c 参数的作用是什么？" },
      { id: "a1", role: "assistant", content: "该参数用于控制电池快充过程中的目标温度区间。" }
    ];

    expect(deriveThreadTitle(messages)).toBe("battery_temp_target_c 参数的作用是什么？");
    expect(deriveThreadPreview(messages)).toBe("该参数用于控制电池快充过程中的目标温度区间。");
  });

  it("serializes only persistable chat roles with content", () => {
    const serialized = serializeXiaozeMessages([
      { id: "u1", role: "user", content: "你好" },
      { id: "r1", role: "reasoning", content: "先理解用户意图" },
      { id: "a1", role: "assistant", content: "你好，我是小泽。" },
      { id: "a2", role: "assistant", content: "   " }
    ] as Parameters<typeof serializeXiaozeMessages>[0]);

    expect(serialized).toEqual([
      { id: "u1", role: "user", content: "你好" },
      { id: "r1", role: "reasoning", content: "先理解用户意图" },
      { id: "a1", role: "assistant", content: "你好，我是小泽。" }
    ]);
  });

  it("round-trips thread store through memory storage", () => {
    const storage = {
      value: "",
      getItem() {
        return this.value;
      },
      setItem(_key: string, value: string) {
        this.value = value;
      }
    };

    const initial = readXiaozeThreadStore(storage);
    const messages: XiaozeStoredMessage[] = [{ id: "u1", role: "user", content: "查看 fast_charge 参数" }];
    const next = upsertThreadRecord(initial, initial.activeThreadId, messages);
    writeXiaozeThreadStore(next, storage);

    const restored = readXiaozeThreadStore(storage);
    expect(restored.activeThreadId).toBe(initial.activeThreadId);
    expect(restored.threads[0]?.title).toBe("查看 fast_charge 参数");
    expect(restored.threads[0]?.messages).toEqual(messages);
  });

  it("builds thread record metadata from messages", () => {
    const record = buildThreadRecord("thread-1", [
      { id: "u1", role: "user", content: "第一条问题" },
      { id: "a1", role: "assistant", content: "第一条回答" }
    ]);

    expect(record.id).toBe("thread-1");
    expect(record.title).toBe("第一条问题");
    expect(record.preview).toBe("第一条回答");
    expect(record.createdAt).toBeTruthy();
    expect(record.updatedAt).toBeTruthy();
  });

  it("detects unchanged stored messages", () => {
    const left = [{ id: "u1", role: "user" as const, content: "aurora charge" }];
    const right = [{ id: "u1", role: "user" as const, content: "aurora charge" }];
    expect(areStoredMessagesEqual(left, right)).toBe(true);
    expect(areStoredMessagesEqual(left, [{ id: "u1", role: "user", content: "changed" }])).toBe(false);
  });

  it("does not keep empty threads in history", () => {
    const draft = createEmptyThreadSnapshot("draft-thread");
    const withEmptyUpsert = upsertThreadRecord(draft, "draft-thread", []);
    expect(withEmptyUpsert.threads).toEqual([]);

    const messages: XiaozeStoredMessage[] = [{ id: "u1", role: "user", content: "第一条问题" }];
    const withMessages = upsertThreadRecord(withEmptyUpsert, "draft-thread", messages);
    expect(withMessages.threads).toHaveLength(1);
    expect(withMessages.threads[0]?.messages).toEqual(messages);
  });

  it("drops legacy empty threads when reading storage", () => {
    const storage = {
      value: JSON.stringify({
        activeThreadId: "draft-1",
        threads: [
          {
            id: "empty-1",
            title: "新对话",
            preview: "暂无消息",
            createdAt: "2026-06-25T00:40:00.000Z",
            updatedAt: "2026-06-25T00:40:00.000Z",
            messages: []
          },
          {
            id: "filled-1",
            title: "已有对话",
            preview: "回答内容",
            createdAt: "2026-06-25T00:41:00.000Z",
            updatedAt: "2026-06-25T00:41:00.000Z",
            messages: [{ id: "u1", role: "user", content: "你好" }]
          }
        ]
      }),
      getItem() {
        return this.value;
      },
      setItem(_key: string, value: string) {
        this.value = value;
      }
    };

    const restored = readXiaozeThreadStore(storage);
    expect(restored.activeThreadId).toBe("draft-1");
    expect(restored.threads).toHaveLength(1);
    expect(restored.threads[0]?.id).toBe("filled-1");
  });

  it("removes a thread from the snapshot without touching others", () => {
    const snapshot = {
      activeThreadId: "thread-2",
      threads: [
        {
          id: "thread-1",
          title: "第一条",
          preview: "回答一",
          createdAt: "2026-06-24T08:00:00.000Z",
          updatedAt: "2026-06-24T08:01:00.000Z",
          messages: [{ id: "u1", role: "user" as const, content: "第一条" }]
        },
        {
          id: "thread-2",
          title: "第二条",
          preview: "回答二",
          createdAt: "2026-06-24T08:02:00.000Z",
          updatedAt: "2026-06-24T08:03:00.000Z",
          messages: [{ id: "u2", role: "user" as const, content: "第二条" }]
        }
      ]
    };

    const next = removeThreadFromSnapshot(snapshot, "thread-1");
    expect(next.threads).toHaveLength(1);
    expect(next.threads[0]?.id).toBe("thread-2");
    expect(next.activeThreadId).toBe("thread-2");
  });
});
