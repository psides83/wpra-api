alter table public.wpra_athletes
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

create index if not exists wpra_athletes_contestant_key_idx
  on public.wpra_athletes (contestant_key);
