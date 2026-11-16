-- Photos and photo requests. Expand-only and idempotent: see docs/photos.md before adding a file here.
create table if not exists media.photos (
  id text primary key,
  home_id text not null,
  level_id text,
  x double precision not null,
  y double precision not null,
  z double precision not null,
  yaw double precision not null,
  pitch double precision not null,
  fov_h double precision,
  captured_room_id text,
  captured_room_name text,
  taken_at timestamp with time zone not null,
  note text not null default '',
  tags jsonb not null default '[]'::jsonb,
  request_id text,
  content_type text not null,
  width integer not null,
  height integer not null,
  byte_size integer not null,
  thumbnail_content_type text not null,
  thumbnail_width integer not null,
  thumbnail_height integer not null,
  thumbnail_byte_size integer not null,
  sha256 text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone
);
--> statement-breakpoint
create index if not exists photos_home_taken_at_idx on media.photos (home_id, taken_at);
--> statement-breakpoint
create index if not exists photos_request_id_idx on media.photos (request_id);
--> statement-breakpoint
create table if not exists media.photo_blobs (
  photo_id text primary key references media.photos (id) on delete cascade,
  data bytea not null
);
--> statement-breakpoint
create table if not exists media.photo_thumbnails (
  photo_id text primary key references media.photos (id) on delete cascade,
  data bytea not null
);
--> statement-breakpoint
create table if not exists media.photo_requests (
  id text primary key,
  home_id text not null,
  level_id text,
  room_id text,
  room_name text,
  x double precision,
  z double precision,
  yaw double precision,
  pitch double precision,
  reason text not null,
  requester text not null,
  status text not null default 'open',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  closed_at timestamp with time zone,
  deleted_at timestamp with time zone
);
--> statement-breakpoint
create index if not exists photo_requests_home_idx on media.photo_requests (home_id, created_at);
