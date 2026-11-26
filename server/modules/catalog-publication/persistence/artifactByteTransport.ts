// PostgreSQL normally sends bytea as hex text. Bound each DataRow field so
// pg-protocol can decode it even when the complete artifact exceeds V8's
// string limit. Read every chunk of an artifact in the same SQL snapshot.
export const ARTIFACT_BYTE_CHUNK_SIZE = 8 * 1024 * 1024;

export const artifactByteColumns = `
  octet_length(artifact.artifact_bytes) as artifact_byte_length,
  chunk.byte_start as artifact_byte_start,
  substr(artifact.artifact_bytes, chunk.byte_start, ${ARTIFACT_BYTE_CHUNK_SIZE}) as artifact_byte_chunk`;

export const artifactByteChunkJoin = `
  cross join lateral generate_series(
    1, octet_length(artifact.artifact_bytes), ${ARTIFACT_BYTE_CHUNK_SIZE}
  ) as chunk(byte_start)`;

export type ArtifactByteChunkRow = {
  readonly artifact_byte_length: number;
  readonly artifact_byte_start: number;
  readonly artifact_byte_chunk: Buffer;
};

export function assembleArtifactBytes(rows: readonly ArtifactByteChunkRow[]): Uint8Array {
  const first = rows[0];
  if (!first || first.artifact_byte_length <= 0) {
    throw new Error("Catalog artifact has no bytes");
  }
  const only = first.artifact_byte_chunk;
  if (rows.length === 1 && first.artifact_byte_start === 1 &&
      only.byteLength === first.artifact_byte_length && only.byteLength <= ARTIFACT_BYTE_CHUNK_SIZE &&
      only.byteOffset === 0 && only.byteLength === only.buffer.byteLength) {
    return new Uint8Array(only.buffer);
  }
  const bytes = new Uint8Array(first.artifact_byte_length);
  let offset = 0;
  for (const row of rows) {
    const chunk = row.artifact_byte_chunk;
    if (
      row.artifact_byte_length !== bytes.byteLength ||
      row.artifact_byte_start !== offset + 1 ||
      chunk.byteLength !== Math.min(ARTIFACT_BYTE_CHUNK_SIZE, bytes.byteLength - offset) ||
      chunk.byteLength === 0
    ) {
      throw new Error("Catalog artifact bytes are incomplete or out of order");
    }
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (offset !== bytes.byteLength) {
    throw new Error("Catalog artifact bytes are incomplete");
  }
  return bytes;
}
