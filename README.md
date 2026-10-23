# Ventidoc

Multi-tenant inventory and business-management SaaS. This repository currently contains the **secure API foundation** (stage 1).

| Path | What |
|---|---|
| `apps/api` | NestJS + Prisma API (auth, tenancy, RBAC, subscriptions, first inventory slice) |
| `docs/architecture` | Assessment, architecture, tenant isolation, data model, RBAC (+ generated matrix), subscriptions, plan |
| `docker-compose.yml` | Local PostgreSQL 17 (:5434) and Redis 7 (:6380), bound to 127.0.0.1 |

Web (Next.js) and mobile (Flutter) apps are the next stages. See [the implementation plan](docs/architecture/06-implementation-plan.md).

## Run locally

Requirements: Node ≥ 22, pnpm 10, Docker.

```sh
cp .env.example .env              # then replace every CHANGE_ME (openssl rand -base64 48)
ln -sf ../../.env apps/api/.env   # the API, Prisma and tests read apps/api/.env
pnpm install                      # also generates the Prisma client
pnpm infra:up                     # Postgres + Redis; first start creates the DB roles

pnpm api db:migrate               # apply migrations as ventidoc_migrator
pnpm api db:seed                  # sync permission catalogs and plans (no users, no passwords)
pnpm api build && pnpm api start  # http://localhost:3000, OpenAPI UI at /docs
```

Development mail is printed to the API log by the email worker (development LOG provider). Open the verification link from there. The API **refuses to start with `NODE_ENV=production`** until a real mail transport, Redis-backed rate limiting and MFA exist.

> `pnpm api dev` uses `nest start --watch`. Don't run the API with `tsx`: esbuild doesn't emit decorator metadata, so dependency injection fails.

### First platform administrator

Register and verify a user through the API, then:

```sh
pnpm api bootstrap:super-admin --email you@example.com --confirm
```

This works only while no super administrator exists. There is no default admin account or password.

## Checks

```sh
pnpm api typecheck
pnpm api lint
pnpm api test                 # unit tests (no database)
pnpm api test:e2e             # integration + security tests against ventidoc_test and Redis DB 1 (needs `pnpm infra:up`)
pnpm api db:check-migrations  # protects hand-written SQL from Prisma auto-generated drops
pnpm api docs:rbac            # regenerate docs/architecture/rbac-matrix.md
```

Integration tests refuse to run against a database whose name doesn't end in `_test`, and abort with `BLOCKED` if the Redis test service is unreachable.

Multi-factor authentication (mandatory for platform administrators and organization owners), keys and recovery: [docs/security/mfa.md](docs/security/mfa.md).

Email (queued delivery, Resend/SMTP, admin-managed configuration, DNS setup): [docs/security/email.md](docs/security/email.md). In development, emails are printed to the API log (`EMAIL_BOOTSTRAP_DEV_PROVIDER=LOG`, delivered by the inline worker). To run delivery separately: `EMAIL_WORKER_MODE=external` on the API and `pnpm api worker`. Hosting requirements: [docs/operations/hosting.md](docs/operations/hosting.md).

Rate limiting, client-IP trust (`TRUSTED_PROXIES`) and Redis requirements: [docs/security/rate-limiting-and-abuse-protection.md](docs/security/rate-limiting-and-abuse-protection.md).

## Security model in one paragraph

Password hashes live in a table only the dedicated `ventidoc_auth` role can read. Access tokens carry only user + session IDs. Every request re-checks the session, then reloads membership, roles and overrides from PostgreSQL, so revocation is immediate. Organization routes are guarded by `@RequirePermission`, and a test fails the build for any unguarded route. Tenant data is reachable only through `TenantDb`, which sets transaction-local tenant context. That context comes from a server-validated membership, never from the raw URL. PostgreSQL enforces **forced, membership-bound RLS** (the database itself checks that the context user is an active member) for a runtime role that can't bypass it, composite foreign keys block cross-tenant links, and ledgers are append-only. Platform administrators have a separate RBAC system and can't see business data. Details: [docs/architecture/02-tenant-isolation.md](docs/architecture/02-tenant-isolation.md).
