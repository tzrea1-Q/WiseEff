import assert from "node:assert/strict";
import { Socket } from "node:net";
import pg from "pg";

// Socket bytes include PostgreSQL protocol overhead, snapshots and BYTEA text encoding.
// ReadyForQuery is one completed client/server exchange, including transaction control.
export function observePublicationWire(pool: pg.Pool) {
  let exchanges = 0;
  let historyReadBytes = 0;
  let snapshotReadBytes = 0;
  let checkpointReadBytes = 0;
  let artifactRecordsRead = 0;
  const sockets = new Set<Socket>();
  pool.on("acquire", client => {
    assert(client instanceof pg.Client && client.connection.stream instanceof Socket);
    if (sockets.has(client.connection.stream)) return;
    sockets.add(client.connection.stream);
    client.connection.on("readyForQuery", () => { exchanges++; });
    let artifactColumn = -1;
    let byteSource: "history" | "snapshot" | "checkpoint" = "history";
    let chunkOffsetColumn = -1;
    client.connection.on("rowDescription", (message: { fields: { name: string }[] }) => {
      const columns = message.fields.map(field => field.name);
      byteSource = columns.includes("target_checksum") ? "snapshot" : columns.includes("artifact_digest") ? "history" : "checkpoint";
      chunkOffsetColumn = columns.indexOf("artifact_byte_start");
      artifactColumn = columns.indexOf("artifact_byte_chunk");
    });
    client.connection.on("dataRow", (message: { fields: (string | null)[] }) => {
      const value = message.fields[artifactColumn];
      if (value != null) {
        assert(value.startsWith("\\x"), "Expected PostgreSQL hex BYTEA output");
        const bytes = (value.length - 2) / 2;
        if (byteSource === "snapshot") snapshotReadBytes += bytes;
        else if (byteSource === "checkpoint") checkpointReadBytes += bytes;
        else {
          historyReadBytes += bytes;
          if (message.fields[chunkOffsetColumn] === "1") artifactRecordsRead++;
        }
      }
    });
  });
  return () => ({
    exchanges, historyReadBytes, snapshotReadBytes, checkpointReadBytes, artifactRecordsRead,
    receivedBytes: [...sockets].reduce((sum, socket) => sum + socket.bytesRead, 0),
    sentBytes: [...sockets].reduce((sum, socket) => sum + socket.bytesWritten, 0),
  });
}
