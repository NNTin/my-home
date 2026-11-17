create table if not exists userdata.placements (
  home_id text not null,
  id text not null,                         -- stable use id, unique per home, never reused
  type_id text not null,                    -- e.g. furniture.bed
  name text not null,
  level_id text not null,
  room_id text,
  x double precision not null,
  z double precision not null,
  rotation_y double precision not null,
  params jsonb not null default '{}'::jsonb, -- basic-parameter overrides only
  version integer not null default 1,        -- optimistic concurrency
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  removed_at timestamp with time zone,       -- in the trash; purged after 30 days
  primary key (home_id, id)
);
--> statement-breakpoint
create index if not exists placements_home_active_idx on userdata.placements (home_id) where removed_at is null;
--> statement-breakpoint
create index if not exists placements_type_idx on userdata.placements (type_id);
--> statement-breakpoint
create table if not exists userdata.opening_overrides (
  home_id text not null,
  use_id text not null,                     -- opening / roof window / outbuilding opening / gate id from git
  type_id text not null,                    -- the use's type when written; a later git change is detected by comparing
  params jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (home_id, use_id)
);
--> statement-breakpoint
create table if not exists userdata.history (
  id text primary key,                      -- uuid
  seq bigint generated always as identity,  -- total order (timestamps can tie)
  home_id text not null,
  use_id text not null,
  use_kind text not null,                   -- placement | opening
  action text not null,                     -- create | update | remove | restore | undo | import
  actor text not null,                      -- owner | agent | system
  actor_source text not null,               -- identity | declared | default
  actor_name text,                          -- the authentik username when known
  at timestamp with time zone not null default now(),
  before jsonb,                             -- UseState or null (create)
  after jsonb,                              -- UseState
  undoes_id text                            -- the entry this one undoes
);
--> statement-breakpoint
create index if not exists history_use_idx on userdata.history (home_id, use_id, seq desc);
--> statement-breakpoint
create unique index if not exists history_undoes_idx on userdata.history (undoes_id) where undoes_id is not null;
--> statement-breakpoint
create table if not exists userdata.issued_ids (
  home_id text not null,
  id text not null,                         -- every use id ever handed out; never deleted, so ids are never reused
  issued_at timestamp with time zone not null default now(),
  primary key (home_id, id)
);
