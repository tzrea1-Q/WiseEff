#!/bin/sh
set -e
# Compose supplies `server /data ...`, as with the official MinIO entrypoint.
if [ "$1" != minio ]; then
  set -- minio "$@"
fi
exec "$@"
