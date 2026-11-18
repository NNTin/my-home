-- Links from photos and photo requests to catalogue types and uses (docs/photos.md § Subjects). Expand-only:
-- a new table, and two nullable columns that older builds neither read nor write.
create table if not exists media.photo_subjects (
  photo_id text not null references media.photos (id) on delete cascade,
  subject_kind text not null,
  subject_id text not null,
  created_at timestamp with time zone not null default now(),
  primary key (photo_id, subject_kind, subject_id)
);
--> statement-breakpoint
create index if not exists photo_subjects_subject_idx on media.photo_subjects (subject_kind, subject_id);
--> statement-breakpoint
alter table media.photo_requests add column if not exists subject_kind text;
--> statement-breakpoint
alter table media.photo_requests add column if not exists subject_id text;
