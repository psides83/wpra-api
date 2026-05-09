alter table public.standings
  add column if not exists contestant_key text
  generated always as (
    lower(
      trim(
        coalesce(first_name, '') || '|' ||
        coalesce(last_name, '') || '|' ||
        coalesce(hometown, '')
      )
    )
  ) stored;

drop index if exists standings_unique_slot_idx;

create unique index if not exists standings_unique_contestant_idx
  on public.standings (season_year, event, type, circuit_id_key, contestant_key);
