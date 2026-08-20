# Runbooks

> Chinese: [Chinese](../zh-CN/runbooks/README.md)

Runbooks describe repeatable operational procedures. They complement the design docs: design explains the intended architecture; runbooks explain what an operator does during staging, pilot, incident, or evidence collection work.

## Runbook Index

- [M5 Commercial Pilot Readiness](m5-commercial-pilot-readiness.md): current go/no-go checklist and pilot gate.
- [Self-Hosted Runtime](self-hosted-runtime.md): M6.1 single-Linux-server runtime startup, smoke, and emergency stop. Start from the [setup wizard](../../ops/self-hosted/setup.md). Hosts with an IP and no DNS can also use [ops/self-hosted/ip-lab.md](../../ops/self-hosted/ip-lab.md).
- [Self-Hosted Upgrade](../../ops/self-hosted/upgrade.md): immutable target resolution, pre-downtime build, data-preserving full recreation, recovery point, resume, and explicit rollback.
- [WSL Linux Validation](wsl-linux-validation.md): local WSL lab validation scope, known limitations, and target-evidence gaps.
- [Identity Provider](identity-provider.md): M6.2 self-hosted OIDC, Keycloak reference setup, token rotation, and Admin recovery.
- [Durable Queue](durable-queue.md): M6.4 Redis/BullMQ queue operation, health, retry, and incident handling.
- [Manual Acceptance](manual-acceptance.md): human acceptance checklist for product workflows, runtime gates, evidence capture, and Go/No-Go judgment.
- [Staging Deployment](staging-deployment.md): deploy order and smoke sequence for staging.
- [Backup And Restore](backup-restore.md): M6.3 PostgreSQL and S3-compatible object-store backup/restore drill procedure, plus DTS overlay artifact retention / `overlay-artifact-gc`.
- [Rollback](rollback.md): rollback rehearsal and emergency rollback sequence.
- [Self-Hosted Release And Rollback](release-rollback.md): M6.6 release-candidate, capacity, target synthetic, and rollback rehearsal procedure.
- [Monitoring And Alerting](monitoring-alerting.md): signals, alerts, and first triage.
- [Observability Operations](observability-operations.md): Prometheus, alert rules, Grafana dashboards, and M6.5 alert response.
- [Parameter Identity Cutover](parameter-identity-cutover.md): maintenance-window write freeze, dry-run/apply, atomic cutover, observation, and whole-snapshot restore for semantic parameter identity.
- [Incidents](incidents.md): severity, evidence, handoff, and closure for operational incidents.
- [HDC Device Lab](hdc-device-lab.md): real-device evidence collection.
- [ADB Device Lab](adb-device-lab.md): local real-device ADB evidence collection.
- [Agent Provider](agent-provider.md): live provider readiness, fallback, and trace evidence.
- [Log Analysis LLM](log-analysis-llm.md): log-analysis provider readiness, honest degradation chain, and evidence discipline.
- [Platform Admin And Schema Promotion](platform-admin-and-schema-promotion.md): bootstrap the first `platform-admin`, and promote/revert organization driver schema overlays to the platform tier.

## Evidence Rule

Repository-local tests can prove code paths and local integration. Target-environment claims need evidence from the target environment. Record M5 pilot evidence in [../generated/m5-pilot-acceptance.md](../generated/m5-pilot-acceptance.md). Record M6 self-hosted release, rollback, capacity, and target synthetic evidence in [../generated/m6-release-readiness.md](../generated/m6-release-readiness.md) or an approved external release record.
