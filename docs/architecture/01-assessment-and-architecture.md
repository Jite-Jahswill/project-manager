# 1. Repository assessment and architecture

## 1.1 Assessment (2026-10-21)

| Item | Finding | Action taken |
|---|---|---|
| Project directory | `~/Downloads/ventidoc` was **empty**: no code, tests, config or conventions to preserve. | Greenfield build. |
| Version control | The folder was inside a git repository rooted at the **home directory** (`~`), which had unrelated staged changes. Committing from here would have written into that repository. | `git init` inside `ventidoc/` so the project has its own history. The home-level repository was not touched. |
| Toolchain | Node 24.22, pnpm 10.34, Docker 29.8, Flutter 3.47 / Dart 3.13 installed. | Used as-is. |
| Local services | Homebrew PostgreSQL 18 on :5432 (password-protected, not ours), Redis on :6379, and another project's container (`havenhub-postgres-1`) on :5433. | Ventidoc runs its own containers on **:5434** (Postgres 17) and **:6380** (Redis 7), bound to 127.0.0.1. Existing services were left alone. |
| Dependency versions | npm `latest` for Prisma pointed at a release candidate (8.0.0-rc); NestJS 12 had just shipped. | Pinned **Prisma 7.10.0** (stable, published 2026-08) and **NestJS 11.2.7** (mature ecosystem: throttler, swagger). Newest patch releases younger than two weeks were avoided. |
| Local tooling issue | Homebrew `watchman` is broken (missing `libfmt.11.dylib`). | Jest configured with `watchman: false`. Fix locally with `brew reinstall watchman` if you use it elsewhere. |

## 1.2 Architecture

```
                 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
                 │  Web (Next)  │   │ iOS (Flutter)│   │Android(Flutter)
                 │  cookies+CSRF│   │ bearer+secure│   │ bearer+secure│
                 └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
                        └──────────────────┼──────────────────┘
                                           ▼
       ┌─────────────────────────────── API (NestJS, modular monolith) ─────────────────────────────┐
       │ ThrottlerGuard → AuthGuard (session re-checked every request) → OrgAccessGuard /           │
       │ PlatformAccessGuard (permissions loaded from DB every request) → ValidationPipe (whitelist) │
       │                                                                                             │
       │  auth │ authz │ organizations │ subscriptions │ inventory │ platform │ audit │ mail          │
       │                         │                                                                   │
       │                    TenantDb  ── the only path to tenant tables; sets transaction-local     │
       │                         │        app.org_id / app.user_id / app.platform_scope              │
       └─────────────────────────┼───────────────────────────────────────────────────────────────────┘
                                 ▼
             PostgreSQL (role ventidoc_app: NOSUPERUSER NOBYPASSRLS, owns nothing)
             RLS FORCED on every tenant table · composite (id, organization_id) FKs ·
             CHECK constraints · append-only triggers on ledgers
                   Redis (provisioned; queues + distributed rate limits are the next stage)
```

### Module boundaries (`apps/api/src`)

| Module | Owns | May call |
|---|---|---|
| `auth` | Users, sessions, refresh tokens, verification/reset tokens, global `AuthGuard` | database, audit, mail |
| `authz` | Permission registries (org + platform), role templates, pure evaluator, delegation rule, guards | database |
| `organizations` | Organizations, memberships, invitations, branches, roles, assignments, overrides | authz, subscriptions, audit, mail |
| `subscriptions` | Plans, entitlements, `EntitlementService` | database |
| `inventory` | Products, stock balances, stock movements | authz, subscriptions, audit |
| `platform` | Platform admin endpoints, super-admin bootstrap | authz, audit |
| `audit` | Append-only audit writer | database |
| `database` | `PrismaService` (app role), `TenantDb` | — |

Rules:
- Business rules live only in the API. Web and mobile render what the API returns; permission lists returned to clients are UI hints, never enforcement.
- Controllers never check role names. They declare `@RequirePermission('<key>')`, and services receive an `EffectiveAccess`.
- A module reads another module's tables only through that module's service. The inventory slice is the current exception: it reads `branches` for existence checks.

### Key decisions

| Decision | Rationale |
|---|---|
| Access tokens carry only `sub` + `sid`; permissions are loaded from the DB on every request | Revocation and role changes apply on the next request (requirement §5). Cost: about 2 small indexed queries per request. A versioned cache is the planned optimization. |
| `TenantDb.inOrg()` accepts only an `EffectiveAccess` | A raw, client-supplied org ID cannot open a tenant context. The two unavoidable exceptions (org creation, invitation acceptance) use the explicitly named `inOrgUnchecked`. |
| Organization IDs generated by the API | Tenant context can be set *before* the first insert, so org creation needs no RLS bypass. |
| Owner is a locked system role that short-circuits to "all permissions" | New permissions automatically reach owners, and owners can't lock themselves out by editing their own role. |
| Role assignment optionally carries a `branch_id` | One table expresses both "branch assignment" and "role at that branch" (e.g. manager at branch A, cashier at branch B). |
| Refuse to start with `NODE_ENV=production` | Mail, distributed rate limiting and MFA are not production-ready yet. Failing closed beats shipping development stand-ins. |
