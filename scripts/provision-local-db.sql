-- Local/CI provisioning (run once as a PostgreSQL superuser). Not a migration:
-- creating roles and databases needs superuser rights (MIGRATIONS_STRATEGY.md §7).
-- Passwords come from psql variables, never from this file:
--   psql -v owner_password=... -v runtime_password=... -f scripts/provision-local-db.sql
SELECT format('CREATE ROLE app_owner LOGIN PASSWORD %L', :'owner_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') \gexec
SELECT format('CREATE ROLE app_runtime LOGIN PASSWORD %L', :'runtime_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') \gexec
ALTER ROLE app_owner SET timezone = 'UTC';
ALTER ROLE app_runtime SET timezone = 'UTC';
SELECT 'CREATE DATABASE ers_dev OWNER app_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'ers_dev') \gexec
SELECT 'CREATE DATABASE ers_test OWNER app_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'ers_test') \gexec
