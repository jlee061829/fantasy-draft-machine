-- Runs automatically on a fresh Postgres volume via /docker-entrypoint-initdb.d.
-- Creates the isolated database used by integration tests (see apps/web/.env.test)
-- so tests never run against the fantasy_draft dev database.
CREATE DATABASE fantasy_draft_test;
