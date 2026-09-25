-- Stop future scheduled calls; leaves prior audit rows and Vault secret intact.
select cron.unschedule('fwr-yahoo-refresh')
where exists (select 1 from cron.job where jobname = 'fwr-yahoo-refresh');
