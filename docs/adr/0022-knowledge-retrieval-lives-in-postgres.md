# ADR-0022: Knowledge retrieval lives in PostgreSQL

- Status: Accepted
- Date: 2026-08-12

The knowledge base adds semantic (RAG) and full-text retrieval over organization knowledge entries. We store retrieval state in the existing PostgreSQL instance — chunk rows with a pgvector embedding column plus full-text/trigram indexes — instead of introducing a dedicated vector database. Embeddings are optional: they are produced through an OpenAI-compatible `EMBEDDING_API_*` endpoint, and when no endpoint (or no pgvector extension) is available the knowledge base degrades to full-text search only and stays fully usable.

## Considered options

- **Dedicated vector database (Qdrant, Milvus, etc.)** — rejected at current scale. It adds a stateful service to every self-hosted deployment, a second backup/restore surface, and a source-of-truth/index consistency problem, for scale headroom the product does not yet need.
- **Hard dependency on an embedding service** — rejected. Self-hosted deployments must stay viable with no reachable LLM/embedding endpoint; retrieval quality degrades but the product does not break.

## Consequences

- PostgreSQL remains the single source of truth and the single backup/restore surface. Chunk and embedding rows are derived data, always rebuildable from published revisions, so they may be rebuilt instead of restored.
- Self-hosted PostgreSQL must provide the pgvector extension for semantic retrieval; without it FTS-only mode applies.
- Changing the embedding model is a maintenance reindex, not a schema migration.
- Revisit this decision if a deployment approaches roughly a million chunks or needs cross-organization retrieval infrastructure.
