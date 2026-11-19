-- Wall- and ceiling-mounted placements (docs/furniture.md § Mounting): what a placement is fixed to and the height of
-- its bottom above the level's floor. Rows of an older api get the defaults: on the floor, at 0.
alter table userdata.placements add column if not exists mounting text not null default 'floor';
--> statement-breakpoint
alter table userdata.placements add column if not exists elevation double precision not null default 0;
