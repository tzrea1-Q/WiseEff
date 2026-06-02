# Runbooks

Runbooks describe repeatable operational procedures. They complement the design docs: design explains the intended architecture; runbooks explain what an operator does during staging, pilot, incident, or evidence collection work.

## Runbook Index

- [M5 Commercial Pilot Readiness](m5-commercial-pilot-readiness.md): current go/no-go checklist and pilot gate.
- [Self-Hosted Runtime](self-hosted-runtime.md): M6.1 single-Linux-server runtime startup, smoke, and emergency stop.
- [Manual Acceptance](manual-acceptance.md): human acceptance checklist for product workflows, runtime gates, evidence capture, and Go/No-Go judgment.
- [Staging Deployment](staging-deployment.md): deploy order and smoke sequence for staging.
- [Backup And Restore](backup-restore.md): M6.3 PostgreSQL and S3-compatible object-store backup/restore drill procedure.
- [Rollback](rollback.md): rollback rehearsal and emergency rollback sequence.
- [Monitoring And Alerting](monitoring-alerting.md): signals, alerts, and first triage.
- [HDC Device Lab](hdc-device-lab.md): real-device evidence collection.
- [Agent Provider](agent-provider.md): live provider readiness, fallback, and trace evidence.

## Evidence Rule

Repository-local tests can prove code paths and local integration. Target-environment claims need evidence from the target environment. Record M5 evidence in [../generated/m5-pilot-acceptance.md](../generated/m5-pilot-acceptance.md).
