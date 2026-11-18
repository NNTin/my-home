-- Per-home settings on top of the home model from git, kept by the sync on every deploy (docs/userdata.md).
create table if not exists userdata.home_settings (
  home_id text primary key,
  magnetic_declination jsonb,               -- a Bearing; null = use git's value
  version integer not null default 1,
  updated_at timestamp with time zone not null default now()
);
