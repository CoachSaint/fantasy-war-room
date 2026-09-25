-- Run only after the deployed refresh endpoint has passed auth checks and
-- Vault contains the current Vercel CRON_SECRET as fwr_yahoo_refresh_bearer.
-- The job stores only a Vault lookup, never the bearer value.
do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'fwr_yahoo_refresh_bearer' and length(decrypted_secret) >= 32
  ) then
    raise exception 'fwr_yahoo_refresh_bearer is missing from Supabase Vault';
  end if;
  if exists (select 1 from cron.job where jobname = 'fwr-yahoo-refresh') then
    perform cron.unschedule('fwr-yahoo-refresh');
  end if;
end $$;

select cron.schedule(
  'fwr-yahoo-refresh',
  '0 */2 * * *',
  $job$
    select net.http_post(
      url := 'https://fantasy-war-room-pi.vercel.app/api/integrations/yahoo/refresh',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'fwr_yahoo_refresh_bearer'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);
