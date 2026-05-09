create table if not exists public.wpra_athletes (
  id bigint generated always as identity primary key,
  contestant_id bigint not null,
  first_name text null,
  last_name text null,
  nick_name text null,
  hometown text null,
  updated_at timestamptz not null default now()
);

create unique index if not exists wpra_athletes_contestant_id_uidx
  on public.wpra_athletes (contestant_id);
