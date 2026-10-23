# Hosting and production deployment requirements

**No hosting provider has been selected.** Nothing in this document confirms that any named provider offers a given service. Every capability must be verified with the provider, in writing, before a decision is made.

## Components

| Component | Requirement |
|---|---|
| API (NestJS, `node dist/main.js`) | ≥ 2 instances behind a TLS-terminating load balancer; `TRUSTED_PROXIES` set to exactly the load balancer addresses (docs/security/rate-limiting-and-abuse-protection.md); health check `GET /health` |
| Email worker (`node dist/worker.js`) | ≥ 1 instance (2 for availability; safe by design); `EMAIL_WORKER_MODE=external` on the API |
| PostgreSQL 17 | Managed or self-run with: synchronous or near-synchronous replica and automatic failover; PITR (WAL archiving) with tested restores; TLS for clients; the four roles from `docker/postgres/init/01-roles.sh` (`ventidoc_migrator`, `ventidoc_app`, `ventidoc_auth`, `ventidoc_rls` with BYPASSRLS, which needs superuser at creation: confirm the managed service allows it, or an equivalent) |
| Redis 7 | TLS, ACL user, private network, replica + failover. Sign-in fails closed without it (Stage 2A); email does not depend on it |
| Secrets | A secret manager/KMS for `JWT_ACCESS_SECRET`, `ABUSE_PROTECTION_SECRET`, `MFA_ENCRYPTION_KEYS`, `EMAIL_SECRET_KEYS` and all database/Redis credentials; key backups retained at least as long as database backups |
| Outbound network | HTTPS (443) to the email provider API, or SMTP submission (587/465) if SMTP is used; DNS control for the sending domain |
| Observability | Centralized structured logs (no secrets are logged by the API; still restrict access); alerts on: API 5xx rate, `redis: down`, email `oldestPendingSeconds`, `FAILED` deliveries, database replication lag, disk, backup failures |
| Network controls | Database and Redis reachable only from API/worker subnets; administrative access via VPN/bastion with MFA |

## Evaluating Nigerian infrastructure

Hosting in Nigeria is preferred where practical. Evaluate each candidate (Nigerian cloud/colocation providers, and the nearest hyperscaler regions as a comparison) against the following, and record the evidence:

1. Managed PostgreSQL 17 with HA, PITR, and the role privileges listed above (or full control on VMs).
2. Managed Redis (or equivalent) with TLS and failover.
3. Load balancer with TLS, known egress/ingress addresses for `TRUSTED_PROXIES`.
4. Secret manager/KMS.
5. Backup storage in a second facility; restore tested end to end.
6. Published SLA, incident history, support response times.
7. Outbound connectivity and latency to the email provider's API and to users (measure from the candidate region).
8. Data-protection obligations (e.g. Nigeria Data Protection Act 2023) and whether data may leave the country, which also affects the choice of email provider region.
9. Power and network redundancy of the facility.

A hybrid is acceptable: e.g. application and database in Nigeria, with the email provider abroad. Document the data flows; email addresses and message content leave the country when a foreign email provider is used.

## Not claimed

High availability is **not** provided by the current local setup (single PostgreSQL and Redis containers, no backups). It requires the deployment design above, validated with failover and restore drills.
