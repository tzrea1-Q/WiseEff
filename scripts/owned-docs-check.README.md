# Owned documentation verification

[中文](owned-docs-check.README.zh-CN.md)

The existing `run-upgrade-component-tests.ts` runner accepts the exact
`docs-check` suite. It creates its own pgvector PostgreSQL 16 container, network,
volume and private target receipt using the existing daemon admission and
resource ownership checks, then executes **`npm run docs:check`** in the checked
out repository. The child receives only that owned database connection and
receipt, not an ambient database URL or GitHub OIDC bearer.

Use the runner's existing `--expected-daemon-id` and `--suite docs-check`
arguments after independently observing the development daemon. Hosted callers
also use the existing `--github-hosted` admission. There is no new production
target, remote context or generic shell command input. The normal deadline,
output redaction and exact-resource cleanup apply to npm and its descendants.

`schema-doc` remains the separate generation command. Successful generation is
not documentation verification: `docs-check` invokes both package-defined
governance and schema drift checks and preserves their nonzero status. The
command does not update tracked generated documents. This registration does
not add a CI step or claim a real PostgreSQL run; routing tests alone do not
prove documentation or upgrade readiness.
