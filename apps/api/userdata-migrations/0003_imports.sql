-- One-time imports into userdata (e.g. the named layouts of #3 into the placement set), so each runs once per home.
create table if not exists userdata.imports (
  home_id text not null,
  source text not null,
  at timestamp with time zone not null default now(),
  detail jsonb not null default '{}'::jsonb,
  primary key (home_id, source)
);
