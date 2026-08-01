create table if not exists public.wpra_standings (
  id bigint primary key,
  season_year integer not null,
  event text not null check (event in ('GB', 'LB')),
  type text not null check (type in ('world', 'rookie', 'circuit')),
  circuit_id integer null,
  contestant_id bigint null,
  photo_url text null,
  place integer not null,
  first_name text null,
  last_name text null,
  hometown text null,
  earnings numeric null,
  points numeric null,
  updated_at timestamptz not null default now()
);

alter table public.wpra_standings
  add column if not exists id bigint,
  add column if not exists season_year integer,
  add column if not exists event text,
  add column if not exists type text,
  add column if not exists circuit_id integer,
  add column if not exists contestant_id bigint,
  add column if not exists photo_url text,
  add column if not exists place integer,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists hometown text,
  add column if not exists earnings numeric,
  add column if not exists points numeric,
  add column if not exists updated_at timestamptz default now();

create unique index if not exists wpra_standings_id_uidx
  on public.wpra_standings (id);

create index if not exists wpra_standings_lookup_idx
  on public.wpra_standings (season_year, event, type, circuit_id, place);

create index if not exists wpra_standings_contestant_idx
  on public.wpra_standings (contestant_id);
