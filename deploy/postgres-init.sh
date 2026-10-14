#!/bin/sh
# Runs once, when the PostgreSQL volume is created (docker-entrypoint-initdb.d). Creates the two
# application roles and the database, as scripts/provision-local-db.sql does for development. The
# passwords come from the environment (deploy/.env.production), never from this file.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_password="$APP_OWNER_PASSWORD" -v runtime_password="$APP_RUNTIME_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE app_owner LOGIN PASSWORD %L', :'owner_password') \gexec
SELECT format('CREATE ROLE app_runtime LOGIN PASSWORD %L', :'runtime_password') \gexec
ALTER ROLE app_owner SET timezone = 'UTC';
ALTER ROLE app_runtime SET timezone = 'UTC';
CREATE DATABASE eventflow OWNER app_owner;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname eventflow -c "REVOKE ALL ON SCHEMA public FROM PUBLIC"
