-- The history of photo pose corrections (docs/photos.md § Correcting a pose). Expand-only: a new table that
-- older builds neither read nor write. Purging a photo deletes its history with it.
create table if not exists media.photo_pose_changes (
  id text primary key,                      -- uuid
  seq bigint generated always as identity,  -- total order (timestamps can tie)
  photo_id text not null references media.photos (id) on delete cascade,
  actor text not null,                      -- owner | agent
  actor_source text not null,               -- identity | declared | default
  actor_name text,                          -- the authentik username when known
  at timestamp with time zone not null default now(),
  before jsonb not null,                    -- PhotoPose
  after jsonb not null,                     -- PhotoPose
  reason text,                              -- e.g. "vanishing-point calibration"
  undoes_id text                            -- the change this one undoes
);
--> statement-breakpoint
create index if not exists photo_pose_changes_photo_idx on media.photo_pose_changes (photo_id, seq desc);
--> statement-breakpoint
create unique index if not exists photo_pose_changes_undoes_idx on media.photo_pose_changes (undoes_id) where undoes_id is not null;
