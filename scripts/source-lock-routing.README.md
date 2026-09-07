# Script source-lock scheduling

[中文](source-lock-routing.README.zh-CN.md)

`npm run test:scripts` first checks workspace links, then executes the complete
four-case rehearsal source-lock file through `test:scripts:source-lock`, and
only then runs the other script suites with their existing parallel behavior.
The general scripts configuration excludes exactly that file to avoid a second
concurrent ancestry walk. Direct use of the general configuration alone is a
focused check, not the complete scripts gate.

The `scripts-pgvector` owned runner uses the same two configurations in separate
sequential child processes. It stops on either failure and shares its original
15-minute deadline and 8 MiB output limit across both stages. Resource admission,
private target receipts and cleanup are unchanged. The source-lock stage neither
opens PostgreSQL nor changes its fixture's frozen source, ancestry checks,
trusted baseline, assertions or 60-second timeout.

Hosted `build-and-test` runs `npm run test:scripts`; Merge bar requires that job
and the existing owned component job to succeed whenever L1 is required. A
skipped or cancelled build cannot count as source-lock evidence. The dedicated
configuration has one worker, no file parallelism and `passWithNoTests: false`;
it contains the whole file, with no test-name filter.

Threats addressed: missing the frozen file in both routes, accidentally running
only one of its four cases, duplicate parallel collection, continuing after a
failed first stage, and accepting a skipped Hosted build. Permanent routing
checks exercise the actual command list and Merge bar program. This scheduling
change removes competition with other script workers; it does not eliminate
the underlying Git history growth or establish a future capacity guarantee.

Documentation impact is this module pair. Main plan, production evidence and
operations manuals remain owned by the parent coordinator. No production
operation, policy, grant or release approval changes.
