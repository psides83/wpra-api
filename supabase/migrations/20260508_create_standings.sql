create table if not exists public.standings (
  id bigint generated always as identity primary key,
  season_year integer not null,
  event text not null check (event in ('GB', 'LB')),
  type text not null check (type in ('world', 'rookie', 'circuit')),
  circuit_id integer null,
  place integer not null,
  first_name text null,
  last_name text null,
  hometown text null,
  earnings numeric null,
  points numeric null,
  updated_at timestamptz not null default now(),
  circuit_id_key integer generated always as (coalesce(circuit_id, -1)) stored
);

create unique index if not exists standings_unique_slot_idx
  on public.standings (season_year, event, type, circuit_id_key, place);

create index if not exists standings_lookup_idx
  on public.standings (season_year, event, type, circuit_id, place);
