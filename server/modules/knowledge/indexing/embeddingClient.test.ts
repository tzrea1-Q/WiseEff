import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildEmbeddingsUrl,
  createDeterministicEmbeddingClient,
  createHttpEmbeddingClient,
  isEmbeddingDeterministicMode,
  resolveKnowledgeEmbeddingClient
} from "./embeddingClient";

function cosine(a: number[], b: number[]) {
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
  }
  return dot;
}

describe("buildEmbeddingsUrl", () => {
  it("appends /v1/embeddings to bare bases and /embeddings to /v1 bases", () => {
    expect(buildEmbeddingsUrl("https://api.example.com")).toBe("https://api.example.com/v1/embeddings");
    expect(buildEmbeddingsUrl("https://api.example.com/")).toBe("https://api.example.com/v1/embeddings");
    expect(buildEmbeddingsUrl("https://api.example.com/v1")).toBe("https://api.example.com/v1/embeddings");
    expect(buildEmbeddingsUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1/embeddings");
  });
});

describe("createHttpEmbeddingClient", () => {
  it("posts an OpenAI-compatible request with bearer auth and maps by index", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] }
          ]
        }),
        { status: 200 }
      )
    );
    const client = createHttpEmbeddingClient({
      baseUrl: "https://embed.example.com/v1",
      model: "bge-m3",
      apiKey: "secret-key",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const vectors = await client.embed(["first", "second"]);
    expect(vectors).toEqual([
      [1, 0],
      [0, 1]
    ]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://embed.example.com/v1/embeddings");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-key" });
    expect(JSON.parse(String(init.body))).toEqual({ model: "bge-m3", input: ["first", "second"] });
  });

  it("fails loudly on non-200 responses and vector-count mismatches", async () => {
    const failing = createHttpEmbeddingClient({
      baseUrl: "https://embed.example.com",
      model: "m",
      fetchImpl: (async () => new Response("boom", { status: 503 })) as unknown as typeof fetch
    });
    await expect(failing.embed(["a"])).rejects.toThrow(/503/);

    const mismatched = createHttpEmbeddingClient({
      baseUrl: "https://embed.example.com",
      model: "m",
      fetchImpl: (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch
    });
    await expect(mismatched.embed(["a"])).rejects.toThrow(/1 inputs/);
  });

  it("reports timeouts with the configured budget", async () => {
    const client = createHttpEmbeddingClient({
      baseUrl: "https://embed.example.com",
      model: "m",
      timeoutMs: 20,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })) as unknown as typeof fetch
    });

    await expect(client.embed(["a"])).rejects.toThrow(/timed out after 20ms/);
  });

  it("returns empty output for empty input without calling the API", async () => {
    const fetchImpl = vi.fn();
    const client = createHttpEmbeddingClient({
      baseUrl: "https://embed.example.com",
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(await client.embed([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createDeterministicEmbeddingClient", () => {
  it("is deterministic and normalized", async () => {
    const client = createDeterministicEmbeddingClient();
    const [first] = await client.embed(["快充温控经验"]);
    const [second] = await client.embed(["快充温控经验"]);
    expect(first).toEqual(second);
    const norm = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("scores token-overlapping texts as more similar, including CJK", async () => {
    const client = createDeterministicEmbeddingClient();
    const [query, related, unrelated] = await client.embed([
      "快充温控 调参",
      "快充温控调参经验:超过 45 度降流",
      "wireless charging coil alignment guide"
    ]);

    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });
});

describe("resolveKnowledgeEmbeddingClient", () => {
  afterEach(() => {
    delete process.env.EMBEDDING_DETERMINISTIC;
  });

  it("returns undefined when unconfigured (FTS-only mode)", () => {
    expect(resolveKnowledgeEmbeddingClient({}, {} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(
      resolveKnowledgeEmbeddingClient({ EMBEDDING_API_BASE_URL: "https://x" }, {} as NodeJS.ProcessEnv)
    ).toBeUndefined();
  });

  it("returns the HTTP client when base url and model are set", () => {
    const client = resolveKnowledgeEmbeddingClient(
      { EMBEDDING_API_BASE_URL: "https://embed.example.com", EMBEDDING_MODEL: "bge-m3" },
      {} as NodeJS.ProcessEnv
    );
    expect(client?.model).toBe("bge-m3");
  });

  it("prefers the deterministic client in EMBEDDING_DETERMINISTIC mode", () => {
    const client = resolveKnowledgeEmbeddingClient({}, { EMBEDDING_DETERMINISTIC: "true" } as NodeJS.ProcessEnv);
    expect(client?.model).toBe("deterministic-fake-embedding");
    expect(isEmbeddingDeterministicMode({ EMBEDDING_DETERMINISTIC: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });
});
