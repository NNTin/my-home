-- The phone's orientation sensor snapshot taken with a photo (docs/photos.md). Nullable: photos stored
-- before it, and by builds that do not know it, simply have none.
alter table media.photos add column if not exists sensors jsonb;
