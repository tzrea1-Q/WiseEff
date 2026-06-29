import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetup = vi.fn().mockResolvedValue(undefined);
const mockFromConnString = vi.fn((_connectionString: string) => ({ setup: mockSetup }));

vi.mock("@langchain/langgraph-checkpoint-postgres", () => ({
  PostgresSaver: {
    fromConnString: (connectionString: string) => mockFromConnString(connectionString)
  }
}));

describe("createPostgresCheckpointerSaver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns a saver from the connection string", async () => {
    const { createPostgresCheckpointerSaver } = await import("./durableCheckpointer");
    const handle = createPostgresCheckpointerSaver({ connectionString: "postgres://user:pass@localhost:5432/db" });

    expect(mockFromConnString).toHaveBeenCalledWith("postgres://user:pass@localhost:5432/db");
    expect(handle.saver).toBeDefined();
    expect(handle.saver.setup).toBe(mockSetup);
  });

  it("calls setup at most once when ensureSetup is invoked twice", async () => {
    const { createPostgresCheckpointerSaver } = await import("./durableCheckpointer");
    const handle = createPostgresCheckpointerSaver({ connectionString: "postgres://localhost/test" });

    await handle.ensureSetup();
    await handle.ensureSetup();

    expect(mockSetup).toHaveBeenCalledTimes(1);
  });
});
