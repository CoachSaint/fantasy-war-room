-- Lightweight database scheduler for the consented Yahoo refresh endpoint.
-- The job and its Vault-held bearer are provisioned only after the candidate
-- endpoint is deployed and its negative/positive auth checks pass.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
