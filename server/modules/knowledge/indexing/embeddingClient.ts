/**
 * Embedding seam for knowledge retrieval, mirroring the AGENT_API_* chat seam:
 * an OpenAI-compatible `/v1/embeddings` endpoint configured via EMBEDDING_API_*.
 * When unconfigured the knowledge base stays in FTS-only mode.
 */
export type KnowledgeEmbeddingClient = {
  model: string;
  embed(texts: string[]): Promise<number[][]>;
};

export type EmbeddingEnv = {
  EMBEDDING_API_BASE_URL?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_API_KEY?: string;
  EMBEDDING_API_TIMEOUT_MS?: number;
};

/** Accepts bases with or without a trailing `/v1`, like the AGENT_API_BASE_URL convention. */
export function buildEmbeddingsUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return /\/v1$/.test(trimmed) ? `${trimmed}/embeddings` : `${trimmed}/v1/embeddings`;
}

type EmbeddingsResponseBody = {
  data?: Array<{ index?: number; embedding?: number[] }>;
};

export function createHttpEmbeddingClient(options: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): KnowledgeEmbeddingClient {
  const endpoint = buildEmbeddingsUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    model: options.model,
    async embed(texts) {
      if (texts.length === 0) {
        return [];
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {})
          },
          body: JSON.stringify({ model: options.model, input: texts }),
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Embedding API responded ${response.status}.`);
        }
        const body = (await response.json()) as EmbeddingsResponseBody;
        const rows = body.data ?? [];
        if (rows.length !== texts.length) {
          throw new Error(`Embedding API returned ${rows.length} vectors for ${texts.length} inputs.`);
        }
        const vectors = new Array<number[]>(texts.length);
        for (let position = 0; position < rows.length; position += 1) {
          const row = rows[position];
          const embedding = row.embedding;
          if (!Array.isArray(embedding) || embedding.length === 0) {
            throw new Error("Embedding API returned an empty vector.");
          }
          vectors[row.index ?? position] = embedding;
        }
        return vectors;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`Embedding API timed out after ${timeoutMs}ms.`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

const DETERMINISTIC_DIMENSIONS = 64;
export const DETERMINISTIC_EMBEDDING_MODEL = "deterministic-fake-embedding";

function fnv1aHash(token: string) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function tokenizeForDeterministicEmbedding(text: string): string[] {
  const tokens: string[] = [];
  for (const run of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/[\u3400-\u9fff]/.test(run)) {
      // CJK runs have no whitespace segmentation: index characters and bigrams
      // so token overlap approximates phrase similarity deterministically.
      for (let index = 0; index < run.length; index += 1) {
        tokens.push(run[index]);
        if (index + 1 < run.length) {
          tokens.push(run.slice(index, index + 2));
        }
      }
    } else {
      tokens.push(run);
    }
  }
  return tokens;
}

/**
 * Deterministic fake embedding for tests and local vector-path verification,
 * mirroring how XIAOZE_DETERMINISTIC fakes the chat model: hashed bag-of-tokens
 * vectors make cosine similarity reflect token overlap without any API.
 */
export function createDeterministicEmbeddingClient(
  options: { dimensions?: number } = {}
): KnowledgeEmbeddingClient {
  const dimensions = options.dimensions ?? DETERMINISTIC_DIMENSIONS;
  return {
    model: DETERMINISTIC_EMBEDDING_MODEL,
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Array<number>(dimensions).fill(0);
        for (const token of tokenizeForDeterministicEmbedding(text)) {
          vector[fnv1aHash(token) % dimensions] += 1;
        }
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
        return vector.map((value) => value / norm);
      });
    }
  };
}

/** Internal test/CI escape hatch; not part of ServerEnv or .env.example (mirrors XIAOZE_DETERMINISTIC). */
export function isEmbeddingDeterministicMode(env: NodeJS.ProcessEnv = process.env) {
  return env.EMBEDDING_DETERMINISTIC === "true";
}

/**
 * Resolves the embedding client for a deployment: deterministic fake when the
 * test escape hatch is on, the HTTP client when EMBEDDING_API_* is configured,
 * otherwise undefined (FTS-only mode).
 */
export function resolveKnowledgeEmbeddingClient(
  env: EmbeddingEnv,
  processEnv: NodeJS.ProcessEnv = process.env
): KnowledgeEmbeddingClient | undefined {
  if (isEmbeddingDeterministicMode(processEnv)) {
    return createDeterministicEmbeddingClient();
  }
  const baseUrl = env.EMBEDDING_API_BASE_URL?.trim();
  const model = env.EMBEDDING_MODEL?.trim();
  if (!baseUrl || !model) {
    return undefined;
  }
  return createHttpEmbeddingClient({
    baseUrl,
    model,
    apiKey: env.EMBEDDING_API_KEY?.trim() || undefined,
    timeoutMs: env.EMBEDDING_API_TIMEOUT_MS
  });
}
