-- Free-text notes on a catalogue type (home_id null: environment-wide) or on a use of a home (docs/userdata.md).
create table if not exists userdata.notes (
  id text primary key,                      -- uuid
  home_id text,                             -- null for type notes
  subject_kind text not null,               -- type | use
  subject_id text not null,                 -- a type id or a use id
  body text not null,
  created_by text not null,                 -- owner | agent | system
  updated_by text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone       -- soft delete; notes are never purged
);
--> statement-breakpoint
create index if not exists notes_subject_idx on userdata.notes (subject_kind, subject_id) where deleted_at is null;
