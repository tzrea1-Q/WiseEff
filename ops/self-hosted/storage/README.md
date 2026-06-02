# Self-Hosted Object Storage

WiseEff M6.3 uses an S3-compatible object-store contract for uploaded logs and generated artifacts. The application is not tied to a cloud provider; operators provide a self-hosted endpoint that supports bucket HEAD, object PUT, object GET, object HEAD, object DELETE, metadata, content type, and checksum validation.

## Deployment Shape

- Run the object store as an operator-managed Linux service or storage appliance.
- Expose a TLS endpoint to the WiseEff API and worker containers.
- Create separate buckets or prefixes for live data, backup export, and restore drills.
- Keep restore drill targets isolated from the live production bucket and prefix.

## Compatibility Probe

`/health/ready` now requires the object store to complete a write/read/head/delete probe. Failures are reported with safe categories and remediation hints rather than raw signed URLs or secrets.

Required behavior:

- Bucket HEAD succeeds.
- Health object PUT succeeds with `x-amz-meta-*` metadata.
- Object HEAD exposes metadata when supported.
- Object GET returns bytes matching the expected checksum.
- Object DELETE removes the probe object.

## Evidence

Run M6.3 drills with:

```bash
npm run backup:drill
npm run restore:drill
npm run backup:check
```

Commit only redacted evidence. Do not commit customer object bytes, database dumps, access keys, signed URLs, or raw provider error payloads.
