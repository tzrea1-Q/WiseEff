# Object Storage Provider Decision

## Decision

WiseEff M6.3 standardizes on an S3-compatible API contract and keeps the concrete provider operator-managed. For a self-hosted commercial pilot, the default reference target is RustFS-compatible behavior because it is designed for S3-compatible self-hosting and can be deployed without a cloud object-storage account.

The application must remain provider-neutral. MinIO-compatible and Ceph Object Gateway deployments are acceptable when they pass the same compatibility probe and backup/restore drill.

## Required Compatibility

- Bucket HEAD.
- Object PUT, GET, HEAD, DELETE.
- `x-amz-meta-*` metadata round trip where supported.
- Content type preservation.
- SHA-256 checksum validation by WiseEff evidence.
- TLS endpoint with documented certificate management.
- Credential rotation procedure.
- Backup/export mechanism or filesystem snapshot procedure.

## Rejected Alternatives

- Cloud-only object storage: rejected for M6.3 because the project direction is self-hosted infrastructure.
- Provider-specific application code: rejected because WiseEff should target S3-compatible behavior rather than a single product SDK.
- Ceph as the default: deferred unless the operator already has storage-cluster expertise.

## Follow-Up

The selected provider must be named in each target evidence record, along with endpoint, bucket, TLS policy, object count, checksum validation, and restore target.
