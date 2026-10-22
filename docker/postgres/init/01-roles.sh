#!/bin/sh
# Creates the database roles Ventidoc depends on:
#   ventidoc_migrator - owns the schema, runs migrations. NOT a superuser.
#   ventidoc_app      - used by the running API for all tenant/business queries.
#                       Cannot bypass RLS, owns nothing, cannot read password hashes.
#   ventidoc_auth     - used only by the API's credential store: read/write
#                       user_credentials and nothing else.
#   ventidoc_rls      - NOLOGIN owner of the SECURITY DEFINER helpers that RLS
#                       policies call to verify membership (BYPASSRLS so the helpers
#                       can read memberships without recursive policy evaluation).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" \
  -v migrator_pw="$VENTIDOC_MIGRATOR_PASSWORD" -v app_pw="$VENTIDOC_APP_PASSWORD" -v auth_pw="$VENTIDOC_AUTH_PASSWORD" <<'SQL'
CREATE ROLE ventidoc_migrator LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB PASSWORD :'migrator_pw';
CREATE ROLE ventidoc_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'app_pw';
CREATE ROLE ventidoc_auth LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'auth_pw';
CREATE ROLE ventidoc_rls NOLOGIN NOSUPERUSER BYPASSRLS;
-- Lets migrations hand helper functions to ventidoc_rls (ALTER FUNCTION ... OWNER).
GRANT ventidoc_rls TO ventidoc_migrator;
CREATE DATABASE ventidoc OWNER ventidoc_migrator;
CREATE DATABASE ventidoc_test OWNER ventidoc_migrator;
\connect ventidoc
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO ventidoc_migrator;
GRANT USAGE ON SCHEMA public TO ventidoc_app, ventidoc_auth;
\connect ventidoc_test
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO ventidoc_migrator;
GRANT USAGE ON SCHEMA public TO ventidoc_app, ventidoc_auth;
SQL
