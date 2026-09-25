-- One Yahoo league is one shared workspace league, regardless of how many
-- managers independently authorize their own Yahoo accounts.
create unique index if not exists idx_leagues_yahoo_provider_key
  on public.leagues (provider, provider_league_id)
  where provider = 'yahoo' and provider_league_id is not null;
